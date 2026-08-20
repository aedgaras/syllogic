"""
Investments tools for the MCP server.

Exposes:
- list_holdings: per-account holdings with latest valuation
- get_portfolio_summary: aggregate portfolio value across investment accounts
- get_portfolio_history: daily portfolio value history (sum of investment account balances)
- search_symbol: lookup symbols seen in user's holdings
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.mcp.dependencies import get_db, validate_date
from app.models import (
    Account,
    AccountBalance,
    Holding,
    HoldingValuation,
    User,
)
from app.services.ownership_service import attribute_amount, entity_ids_for_people, get_owners


INVESTMENT_ACCOUNT_TYPES = ("investment_manual",)


def _latest_valuations_for_user(db: Session, user_id: str):
    """Return mapping of holding_id -> latest HoldingValuation for the user."""
    holding_ids_subq = db.query(Holding.id).filter(Holding.user_id == user_id).subquery()

    latest_dates = (
        db.query(
            HoldingValuation.holding_id.label("hid"),
            func.max(HoldingValuation.date).label("max_date"),
        )
        .filter(HoldingValuation.holding_id.in_(holding_ids_subq))
        .group_by(HoldingValuation.holding_id)
        .subquery()
    )

    rows = (
        db.query(HoldingValuation)
        .join(
            latest_dates,
            (HoldingValuation.holding_id == latest_dates.c.hid)
            & (HoldingValuation.date == latest_dates.c.max_date),
        )
        .all()
    )
    return {v.holding_id: v for v in rows}


def list_holdings_impl(
    db: Session,
    user_id: str,
    account_id: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    """List a user's holdings with latest valuation.

    When person_ids is provided, only holdings whose account_id is in the
    person-owned account set are returned. When exactly one person_id is given,
    current_value_user_currency is share-weighted to that person's ownership
    fraction (quantity is left unweighted so lot-level data remains intact).
    """
    # Resolve allowed accounts from person_ids
    filter_by_person = person_ids is not None and len(person_ids) > 0
    single_person = filter_by_person and len(person_ids) == 1
    allowed_account_ids: Optional[set] = None
    if filter_by_person:
        allowed_account_ids = set(
            str(uid) for uid in entity_ids_for_people(db, "account", person_ids)
        )
        if not allowed_account_ids:
            return []

    query = db.query(Holding).filter(Holding.user_id == user_id)
    if account_id:
        query = query.filter(Holding.account_id == account_id)
    if allowed_account_ids is not None:
        query = query.filter(Holding.account_id.in_(allowed_account_ids))
    holdings = query.order_by(Holding.symbol).all()

    valuations = _latest_valuations_for_user(db, user_id)

    # Cache owners per account for share-weighting
    owners_cache: dict = {}
    if single_person:
        for h in holdings:
            acc_id = str(h.account_id)
            if acc_id not in owners_cache:
                owners_cache[acc_id] = get_owners(db, "account", h.account_id)

    out = []
    for h in holdings:
        v = valuations.get(h.id)
        value_str = str(v.value_user_currency) if v else None
        if single_person and v is not None and v.value_user_currency is not None:
            owners = owners_cache[str(h.account_id)]
            weighted_value = attribute_amount(float(v.value_user_currency), owners, person_ids[0])
            value_str = str(Decimal(str(weighted_value)))
        out.append(
            {
                "id": str(h.id),
                "account_id": str(h.account_id),
                "symbol": h.symbol,
                "name": h.name,
                "currency": h.currency,
                "instrument_type": h.instrument_type,
                "quantity": str(h.quantity) if h.quantity is not None else "0",
                "avg_cost": str(h.avg_cost) if h.avg_cost is not None else None,
                "source": h.source,
                "as_of_date": h.as_of_date.isoformat() if h.as_of_date else None,
                "latest_price": str(v.price) if v else None,
                "latest_valuation_date": v.date.isoformat() if v else None,
                "current_value_user_currency": value_str,
                "is_stale": bool(v.is_stale) if v else None,
                "last_price_error": h.last_price_error,
            }
        )
    return out


def list_holdings(
    user_id: str,
    account_id: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    with get_db() as db:
        return list_holdings_impl(db, user_id, account_id, person_ids)


def get_portfolio_summary_impl(
    db: Session,
    user_id: str,
    person_ids: Optional[list[str]] = None,
) -> dict:
    """Aggregate portfolio value across the user's investment accounts.

    When person_ids is provided, only investment accounts owned by any of the
    specified people are included. When exactly one person_id is given, each
    account's value contribution is share-weighted by that person's ownership.
    """
    user = db.query(User).filter(User.id == user_id).first()
    currency = getattr(user, "functional_currency", "EUR") if user else "EUR"

    filter_by_person = person_ids is not None and len(person_ids) > 0
    single_person = filter_by_person and len(person_ids) == 1

    # Resolve allowed account ids from person ownership
    allowed_account_ids: Optional[set] = None
    if filter_by_person:
        allowed_account_ids = set(
            str(uid) for uid in entity_ids_for_people(db, "account", person_ids)
        )
        if not allowed_account_ids:
            return {
                "currency": currency,
                "total_value": "0",
                "holdings_count": 0,
                "stale_valuations": 0,
                "accounts": [],
            }

    accounts_query = db.query(Account).filter(
        Account.user_id == user_id,
        Account.account_type.in_(INVESTMENT_ACCOUNT_TYPES),
        Account.is_active == True,  # noqa: E712
    )
    if allowed_account_ids is not None:
        accounts_query = accounts_query.filter(Account.id.in_(allowed_account_ids))
    accounts = accounts_query.all()
    account_ids = [a.id for a in accounts]

    valuations = _latest_valuations_for_user(db, user_id)

    # Cache owners per account for share-weighting
    owners_cache: dict = {}
    if single_person:
        for a in accounts:
            owners_cache[str(a.id)] = get_owners(db, "account", a.id)

    # Sum value per account from latest valuations of holdings in those accounts.
    holdings = (
        (
            db.query(Holding)
            .filter(Holding.user_id == user_id, Holding.account_id.in_(account_ids))
            .all()
        )
        if account_ids
        else []
    )

    per_account: dict = {}
    total = Decimal("0")
    stale_count = 0
    for h in holdings:
        v = valuations.get(h.id)
        if v is None:
            continue
        val = Decimal(v.value_user_currency or 0)
        if single_person:
            owners = owners_cache[str(h.account_id)]
            val = Decimal(str(attribute_amount(float(val), owners, person_ids[0])))
        total += val
        if v.is_stale:
            stale_count += 1
        per_account.setdefault(str(h.account_id), Decimal("0"))
        per_account[str(h.account_id)] += val

    accounts_out = []
    for a in accounts:
        accounts_out.append(
            {
                "id": str(a.id),
                "name": a.name,
                "account_type": a.account_type,
                "currency": a.currency,
                "value_user_currency": str(per_account.get(str(a.id), Decimal("0"))),
            }
        )

    return {
        "currency": currency,
        "total_value": str(total),
        "holdings_count": len(holdings),
        "stale_valuations": stale_count,
        "accounts": accounts_out,
    }


def get_portfolio_summary(
    user_id: str,
    person_ids: Optional[list[str]] = None,
) -> dict:
    with get_db() as db:
        return get_portfolio_summary_impl(db, user_id, person_ids)


def get_portfolio_history_impl(
    db: Session,
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Return daily portfolio value history (sum across investment accounts) in functional currency.

    When person_ids is provided, only investment accounts owned by any of the
    specified people are included. When exactly one person_id is given, each
    account's balance contribution is share-weighted by that person's ownership.
    """
    from_dt = validate_date(from_date)
    to_dt = validate_date(to_date)

    filter_by_person = person_ids is not None and len(person_ids) > 0
    single_person = filter_by_person and len(person_ids) == 1

    # Resolve allowed account ids from person ownership
    allowed_person_ids: Optional[set] = None
    if filter_by_person:
        allowed_person_ids = set(
            str(uid) for uid in entity_ids_for_people(db, "account", person_ids)
        )
        if not allowed_person_ids:
            return []

    accounts_query = db.query(Account).filter(
        Account.user_id == user_id,
        Account.account_type.in_(INVESTMENT_ACCOUNT_TYPES),
    )
    if allowed_person_ids is not None:
        accounts_query = accounts_query.filter(Account.id.in_(allowed_person_ids))
    account_objs = accounts_query.all()
    account_ids = [a.id for a in account_objs]

    if not account_ids:
        return []

    # Cache owners per account for share-weighting
    owners_cache: dict = {}
    if single_person:
        for a in account_objs:
            owners_cache[str(a.id)] = get_owners(db, "account", a.id)

    query = db.query(AccountBalance).filter(AccountBalance.account_id.in_(account_ids))
    if from_dt:
        query = query.filter(AccountBalance.date >= from_dt)
    if to_dt:
        query = query.filter(AccountBalance.date <= to_dt)

    rows = query.order_by(AccountBalance.date).all()

    by_date: dict = {}
    for r in rows:
        key = r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date)
        val = Decimal(r.balance_in_functional_currency or 0)
        if single_person:
            owners = owners_cache.get(str(r.account_id), [])
            val = Decimal(str(attribute_amount(float(val), owners, person_ids[0])))
        by_date.setdefault(key, Decimal("0"))
        by_date[key] += val

    return [{"date": d, "value_user_currency": str(v)} for d, v in sorted(by_date.items())]


def get_portfolio_history(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    with get_db() as db:
        return get_portfolio_history_impl(db, user_id, from_date, to_date, person_ids)


def search_symbol_impl(db: Session, user_id: str, query: str) -> list[dict]:
    """Search the user's existing holdings for a symbol/name match."""
    if not query:
        return []
    pattern = f"%{query.lower()}%"
    rows = (
        db.query(Holding.symbol, Holding.name, Holding.currency, Holding.instrument_type)
        .filter(Holding.user_id == user_id)
        .filter(
            (func.lower(Holding.symbol).like(pattern))
            | (func.lower(func.coalesce(Holding.name, "")).like(pattern))
        )
        .distinct()
        .limit(50)
        .all()
    )
    return [
        {
            "symbol": r[0],
            "name": r[1],
            "currency": r[2],
            "instrument_type": r[3],
        }
        for r in rows
    ]


def search_symbol(user_id: str, query: str) -> list[dict]:
    with get_db() as db:
        return search_symbol_impl(db, user_id, query)


def get_holding_trades(user_id: str, holding_id: str) -> list[dict]:
    """Manual holdings have no trade-import data source, so this always
    returns an empty list once the holding's existence is confirmed."""
    with get_db() as db:
        holding = (
            db.query(Holding).filter(Holding.id == holding_id, Holding.user_id == user_id).first()
        )
        return [] if holding else []
