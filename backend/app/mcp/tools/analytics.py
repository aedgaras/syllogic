"""
Analytics tools for the MCP server.

The aggregate queries here are hand-written SQL rather than ORM constructs
because they lean on Postgres-specific shapes (CTEs, FILTER, nested CASE over
linked-transaction net amounts). Every *value* in them is bound as a
parameter; only structural fragments chosen by this module -- a join type, a
fixed predicate -- are ever interpolated into the string.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastmcp.exceptions import ToolError
from sqlalchemy import func, or_, and_, text

from app.mcp.dependencies import get_db, require_date_bound, require_uuid
from app.mcp.errors import invalid_enum
from app.mcp.tools._currency import (
    FUNCTIONAL_AMOUNT_SQL,
    functional_amount_expr,
    user_currency,
)
from app.models import Transaction, Account
from app.services.ownership_service import attribute_amount, entity_ids_for_people, get_owners


# Net amount per link group, so a group of linked transactions contributes its
# net rather than each leg's gross. Scoped to the caller via a bound parameter.
#
# The net is taken in functional currency for the same reason the outer
# aggregates are: a link group spanning two currencies nets gross amounts that
# are not in the same unit, and that bad net then propagates into every query
# that joins this CTE.
_LINK_GROUP_NETS_CTE = f"""
    WITH link_group_nets AS (
        SELECT
            tl.group_id,
            SUM({FUNCTIONAL_AMOUNT_SQL}) as net_amount
        FROM transactions t
        JOIN transaction_links tl ON t.id = tl.transaction_id
        WHERE t.user_id = :user_id
        GROUP BY tl.group_id
    )
    """


# Rows the functional-currency expression could not state in the user's
# currency. Reported alongside every aggregate so an incomplete total is
# visibly incomplete.
_UNCONVERTED_COUNT_SQL = f"COUNT(*) FILTER (WHERE ({FUNCTIONAL_AMOUNT_SQL}) IS NULL)"


VALID_DIRECTIONS = ("expense", "income")

# The periods `group_by` can bucket into, mapped to the date_trunc unit each
# one needs. A dict rather than a pass-through because this value is
# interpolated into SQL: only these five strings can ever reach date_trunc.
_TRUNC_UNITS = {
    "none": None,
    "month": "month",
    "quarter": "quarter",
    "year": "year",
}
VALID_GROUP_BY = tuple(_TRUNC_UNITS)


@dataclass
class _Filters:
    """SQL fragments and the values they bind to.

    The fragments contain only placeholders, never data, so they are safe to
    interpolate into a query string.
    """

    date: str = ""
    account: str = ""
    person: str = ""
    params: dict = field(default_factory=dict)


def _allowed_account_ids_for(person_ids: Optional[list[str]]) -> Optional[list[str]]:
    """Account ids owned by any of `person_ids`.

    Returns None when no person filter was requested. An empty list means the
    named people own no accounts at all -- callers must return an empty result
    for that rather than treating it as "no filter".
    """
    if not person_ids:
        return None
    with get_db() as db:
        return [str(uid) for uid in entity_ids_for_people(db, "account", person_ids)]


def _functional_currency(user_id: str) -> str:
    """The currency every aggregate in this module reports in.

    Opens its own session for the same reason `_allowed_account_ids_for`
    does: the filter set is assembled before the query session is opened.
    """
    with get_db() as db:
        return user_currency(db, user_id)


def _build_filters(
    user_id: str,
    functional_currency: str,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    account_uuid: Optional[UUID] = None,
    allowed_account_ids: Optional[list[str]] = None,
) -> _Filters:
    """Assemble the WHERE fragments shared by the aggregate queries."""
    filters = _Filters(params={"user_id": user_id, "functional_currency": functional_currency})

    if from_dt:
        filters.date += " AND t.booked_at >= :from_dt"
        filters.params["from_dt"] = from_dt
    if to_dt:
        # Exclusive: require_date_bound already advanced a bare YYYY-MM-DD to
        # the following midnight so the named day is included in full.
        filters.date += " AND t.booked_at < :to_dt"
        filters.params["to_dt"] = to_dt

    if account_uuid:
        filters.account = " AND t.account_id = :account_id"
        filters.params["account_id"] = account_uuid

    if allowed_account_ids is not None:
        # ANY over an array keeps this one placeholder regardless of how many
        # accounts the people own, instead of an IN list built by hand.
        filters.person = " AND t.account_id = ANY(CAST(:person_account_ids AS uuid[]))"
        filters.params["person_account_ids"] = allowed_account_ids

    return filters


def get_amounts_by_category(
    user_id: str,
    direction: str = "expense",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    account_id: Optional[str] = None,
    include_uncategorized: bool = False,
    person_ids: Optional[list[str]] = None,
    group_by: str = "none",
) -> list[dict]:
    """
    Totals by category, for money out or money in, optionally by period.

    Replaces get_spending_by_category and get_income_by_category, which were
    the same query twice with the sign and the category type flipped. The
    third argument is the one that was missing: `group_by` turns this into a
    category-by-month cross-tab, which previously cost one call per month or
    a pull of every raw row.

    Args:
        user_id: The user's ID
        direction: "expense" (money out, the default) or "income" (money in)
        from_date: Start of the range, inclusive (optional)
        to_date: End of the range, inclusive (optional)
        account_id: Restrict to one account (optional)
        include_uncategorized: Add an "Uncategorized" bucket for rows with no
            category at all. Expenses only -- income has no equivalent, since
            an uncategorized credit is not identifiable as income.
        person_ids: Restrict to accounts owned by any of these people (optional)
        group_by: "none" (default), "month", "quarter" or "year". Anything but
            "none" adds a `period` field to each row.

    Returns:
        List of rows with category_id, category_name, category_color, total,
        currency, count, unconverted_transaction_count, and merchant_count
        (expenses only). With group_by, each row also carries `period` as a
        YYYY-MM-DD date naming the start of the bucket.
    """
    if direction not in VALID_DIRECTIONS:
        raise invalid_enum("direction", direction, VALID_DIRECTIONS)
    if group_by not in VALID_GROUP_BY:
        raise invalid_enum("group_by", group_by, VALID_GROUP_BY)

    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)
    account_uuid = require_uuid(account_id, "account_id")

    allowed_account_ids = _allowed_account_ids_for(person_ids)
    if allowed_account_ids is not None and not allowed_account_ids:
        return []
    currency = _functional_currency(user_id)
    filters = _build_filters(user_id, currency, from_dt, to_dt, account_uuid, allowed_account_ids)

    expense = direction == "expense"

    # Expenses are debits summed as magnitudes; income is credits summed as
    # signed amounts. For a linked group the primary leg carries the group's
    # net and the other legs carry nothing, so a transfer pair nets to zero
    # instead of being counted twice.
    if expense:
        txn_type = "debit"
        category_type = "expense"
        amount_sql = f"""
                        WHEN tl.link_role = 'primary' THEN
                            CASE WHEN lgn.net_amount < 0 THEN ABS(lgn.net_amount) ELSE 0 END
                        WHEN tl.link_role IS NOT NULL THEN 0
                        ELSE ABS({FUNCTIONAL_AMOUNT_SQL})"""
    else:
        txn_type = "credit"
        category_type = "income"
        amount_sql = f"""
                        WHEN tl.link_role = 'primary' THEN
                            CASE WHEN lgn.net_amount > 0 THEN lgn.net_amount ELSE 0 END
                        WHEN tl.link_role IS NOT NULL THEN 0
                        ELSE {FUNCTIONAL_AMOUNT_SQL}"""

    # Uncategorized only makes sense for expenses, and only with a LEFT JOIN:
    # an INNER JOIN has already dropped the null-category rows. The OR arm is
    # what lets those rows through while still requiring categorised rows to
    # be of the right type.
    uncategorized = expense and include_uncategorized
    join_type = "LEFT JOIN" if uncategorized else "INNER JOIN"
    type_filter = (
        f"AND (c.category_type = '{category_type}' OR c.id IS NULL)"
        if uncategorized
        else f"AND c.category_type = '{category_type}'"
    )

    merchant_count_sql = (
        ",\n                COUNT(DISTINCT t.merchant) FILTER "
        "(WHERE t.merchant IS NOT NULL AND t.merchant <> '') as merchant_count"
        if expense
        else ""
    )

    # Interpolated, not bound: date_trunc's unit is part of the expression,
    # not a value. Safe because it can only be one of the five keys in
    # _TRUNC_UNITS, which the enum check above has already enforced.
    trunc_unit = _TRUNC_UNITS[group_by]
    period_select = (
        f"date_trunc('{trunc_unit}', t.booked_at) as period,\n                "
        if trunc_unit
        else ""
    )
    period_group = f"date_trunc('{trunc_unit}', t.booked_at), " if trunc_unit else ""
    period_order = "period ASC, " if trunc_unit else ""

    with get_db() as db:
        sql = text(f"""
            {_LINK_GROUP_NETS_CTE}
            SELECT
                {period_select}COALESCE(t.category_id, t.category_system_id) as category_id,
                COALESCE(c.name, 'Uncategorized') as category_name,
                c.color as category_color,
                COALESCE(SUM(
                    CASE{amount_sql}
                    END
                ), 0) as total,
                COUNT(t.id) as count,
                {_UNCONVERTED_COUNT_SQL} as unconverted_count{merchant_count_sql}
            FROM transactions t
            {join_type} categories c ON c.id = COALESCE(t.category_id, t.category_system_id)
            LEFT JOIN transaction_links tl ON t.id = tl.transaction_id
            LEFT JOIN link_group_nets lgn ON tl.group_id = lgn.group_id
            WHERE t.user_id = :user_id
                AND t.transaction_type = '{txn_type}'
                AND t.include_in_analytics = true
                {type_filter}
                {filters.date}
                {filters.account}
                {filters.person}
            GROUP BY {period_group}COALESCE(t.category_id, t.category_system_id), c.name, c.color
            ORDER BY {period_order}total DESC
        """)

        results = db.execute(sql, filters.params).fetchall()

        rows = []
        for r in results:
            row = {
                "category_id": str(r.category_id) if r.category_id else None,
                "category_name": r.category_name or "Uncategorized",
                "category_color": r.category_color,
                "total": float(r.total) if r.total else 0,
                "currency": currency,
                "count": r.count,
                "unconverted_transaction_count": r.unconverted_count,
            }
            if expense:
                row["merchant_count"] = r.merchant_count
            if trunc_unit:
                row["period"] = r.period.date().isoformat() if r.period else None
            rows.append(row)
        return rows


def get_spending_by_category(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    account_id: Optional[str] = None,
    include_uncategorized: bool = False,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    """DEPRECATED -- use get_amounts_by_category(direction="expense").

    Kept for one release so existing callers keep working. It has no
    `group_by`; the replacement does.
    """
    return get_amounts_by_category(
        user_id,
        direction="expense",
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
        include_uncategorized=include_uncategorized,
        person_ids=person_ids,
    )


def get_income_by_category(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    account_id: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    """DEPRECATED -- use get_amounts_by_category(direction="income").

    Kept for one release so existing callers keep working. It has no
    `group_by`; the replacement does.
    """
    return get_amounts_by_category(
        user_id,
        direction="income",
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
        person_ids=person_ids,
    )


def get_monthly_cashflow(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> list[dict]:
    """
    Get monthly income vs expenses breakdown.

    Filters by category type to exclude transfers:
    - Income: Only transactions with category_type='income'
    - Expenses: Only transactions with category_type='expense'
    - Uses net amounts for linked transactions (primary gets group net)

    Args:
        user_id: The user's ID
        from_date: Start date in ISO format (optional)
        to_date: End date in ISO format (optional)
        person_ids: Optional list of person UUIDs. When provided, only includes
            transactions from accounts owned by any of the specified people.

    Returns:
        List of monthly data with income, expenses, and net for each month
    """
    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)

    allowed_account_ids = _allowed_account_ids_for(person_ids)
    if allowed_account_ids is not None and not allowed_account_ids:
        return []
    currency = _functional_currency(user_id)
    filters = _build_filters(
        user_id, currency, from_dt, to_dt, allowed_account_ids=allowed_account_ids
    )

    with get_db() as db:
        sql = text(f"""
            {_LINK_GROUP_NETS_CTE}
            SELECT
                EXTRACT(YEAR FROM t.booked_at)::int as year,
                EXTRACT(MONTH FROM t.booked_at)::int as month,
                COALESCE(SUM(
                    CASE
                        WHEN c.category_type = 'income' THEN
                            CASE
                                WHEN tl.link_role = 'primary' THEN
                                    CASE WHEN lgn.net_amount > 0 THEN lgn.net_amount ELSE 0 END
                                WHEN tl.link_role IS NOT NULL THEN 0
                                ELSE ABS({FUNCTIONAL_AMOUNT_SQL})
                            END
                        ELSE 0
                    END
                ), 0) as income,
                COALESCE(SUM(
                    CASE
                        WHEN c.category_type = 'expense' THEN
                            CASE
                                WHEN tl.link_role = 'primary' THEN
                                    CASE WHEN lgn.net_amount < 0 THEN ABS(lgn.net_amount) ELSE 0 END
                                WHEN tl.link_role IS NOT NULL THEN 0
                                ELSE ABS({FUNCTIONAL_AMOUNT_SQL})
                            END
                        ELSE 0
                    END
                ), 0) as expenses,
                {_UNCONVERTED_COUNT_SQL} as unconverted_count
            FROM transactions t
            INNER JOIN categories c ON c.id = COALESCE(t.category_id, t.category_system_id)
            LEFT JOIN transaction_links tl ON t.id = tl.transaction_id
            LEFT JOIN link_group_nets lgn ON tl.group_id = lgn.group_id
            WHERE t.user_id = :user_id
                AND t.include_in_analytics = true
                {filters.date}
                {filters.person}
            GROUP BY EXTRACT(YEAR FROM t.booked_at), EXTRACT(MONTH FROM t.booked_at)
            ORDER BY EXTRACT(YEAR FROM t.booked_at), EXTRACT(MONTH FROM t.booked_at)
        """)

        results = db.execute(sql, filters.params).fetchall()

        return [
            {
                "month": f"{int(r.year)}-{int(r.month):02d}",
                "income": float(r.income) if r.income else 0,
                "expenses": float(r.expenses) if r.expenses else 0,
                "net": float(r.income or 0) - float(r.expenses or 0),
                "currency": currency,
                "unconverted_transaction_count": r.unconverted_count,
            }
            for r in results
        ]


def get_financial_summary(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    person_ids: Optional[list[str]] = None,
) -> dict:
    """
    Get a financial summary with totals and net worth.

    Filters by category type to exclude transfers:
    - Income: Only transactions with category_type='income'
    - Expenses: Only transactions with category_type='expense'
    - Uses net amounts for linked transactions (primary gets group net)

    Args:
        user_id: The user's ID
        from_date: Start date in ISO format (optional)
        to_date: End date in ISO format (optional)
        person_ids: Optional list of person UUIDs. When provided, only includes
            transactions and balances from accounts owned by any of the specified
            people. When exactly one person_id is given, account balances are
            share-weighted to that person's ownership fraction.

    Returns:
        Summary with total income, total expenses, net, and account balances
    """
    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)

    single_person = person_ids is not None and len(person_ids) == 1

    allowed_account_ids = _allowed_account_ids_for(person_ids)
    currency = _functional_currency(user_id)
    if allowed_account_ids is not None and not allowed_account_ids:
        return {
            "period": {"from_date": from_date, "to_date": to_date},
            "currency": currency,
            "total_income": 0,
            "total_expenses": 0,
            "net_cashflow": 0,
            "savings_rate": 0,
            "total_balance": 0,
            "unconverted_transaction_count": 0,
            "unconverted_account_count": 0,
            "accounts": [],
        }
    filters = _build_filters(
        user_id, currency, from_dt, to_dt, allowed_account_ids=allowed_account_ids
    )

    with get_db() as db:
        sql = text(f"""
            {_LINK_GROUP_NETS_CTE}
            SELECT
                COALESCE(SUM(
                    CASE
                        WHEN c.category_type = 'income' THEN
                            CASE
                                WHEN tl.link_role = 'primary' THEN
                                    CASE WHEN lgn.net_amount > 0 THEN lgn.net_amount ELSE 0 END
                                WHEN tl.link_role IS NOT NULL THEN 0
                                ELSE ABS({FUNCTIONAL_AMOUNT_SQL})
                            END
                        ELSE 0
                    END
                ), 0) as total_income,
                COALESCE(SUM(
                    CASE
                        WHEN c.category_type = 'expense' THEN
                            CASE
                                WHEN tl.link_role = 'primary' THEN
                                    CASE WHEN lgn.net_amount < 0 THEN ABS(lgn.net_amount) ELSE 0 END
                                WHEN tl.link_role IS NOT NULL THEN 0
                                ELSE ABS({FUNCTIONAL_AMOUNT_SQL})
                            END
                        ELSE 0
                    END
                ), 0) as total_expenses,
                {_UNCONVERTED_COUNT_SQL} as unconverted_count
            FROM transactions t
            INNER JOIN categories c ON c.id = COALESCE(t.category_id, t.category_system_id)
            LEFT JOIN transaction_links tl ON t.id = tl.transaction_id
            LEFT JOIN link_group_nets lgn ON tl.group_id = lgn.group_id
            WHERE t.user_id = :user_id
                AND t.include_in_analytics = true
                {filters.date}
                {filters.person}
        """)

        result = db.execute(sql, filters.params).fetchone()

        total_income = float(result.total_income or 0)
        total_expenses = float(result.total_expenses or 0)

        # Get account balances (current)
        accounts_query = db.query(Account).filter(
            Account.user_id == user_id, Account.is_active == True
        )
        if allowed_account_ids:
            accounts_query = accounts_query.filter(Account.id.in_(allowed_account_ids))
        accounts = accounts_query.all()

        # Cache owners for share-weighted attribution
        owners_cache: dict = {}
        if single_person:
            for acc in accounts:
                owners_cache[str(acc.id)] = get_owners(db, "account", acc.id)

        def _functional_balance(acc) -> Optional[float]:
            """Balance in the user's currency, or None if it can't be stated there.

            The old expression was `functional_balance or balance_available`,
            which fell back to the account's *native* balance whenever the
            converted one was missing -- so a USD account with no rate on
            record contributed dollars to a euro total. It also treated a
            genuine zero functional_balance as missing.
            """
            if acc.functional_balance is not None:
                return float(acc.functional_balance)
            if acc.currency == currency:
                return float(acc.balance_available or 0)
            return None

        def _attributed(value: float, acc) -> float:
            if single_person:
                return attribute_amount(value, owners_cache[str(acc.id)], person_ids[0])
            return value

        total_balance = 0.0
        unconverted_account_count = 0
        account_balances = []
        for acc in accounts:
            functional = _functional_balance(acc)
            if functional is None:
                unconverted_account_count += 1
            else:
                total_balance += _attributed(functional, acc)

            native = float(acc.balance_available or 0)
            account_balances.append(
                {
                    "id": str(acc.id),
                    "name": acc.name,
                    # Reported in the user's functional currency, like every
                    # other total here. None means the account could not be
                    # converted and is excluded from total_balance.
                    "balance": None if functional is None else _attributed(functional, acc),
                    "currency": currency,
                    "native_balance": _attributed(native, acc),
                    "account_currency": acc.currency,
                    "account_type": acc.account_type,
                }
            )

        return {
            "period": {
                "from_date": from_date,
                "to_date": to_date,
            },
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net_cashflow": total_income - total_expenses,
            "savings_rate": round((total_income - total_expenses) / total_income * 100, 1)
            if total_income > 0
            else 0,
            "total_balance": total_balance,
            "currency": currency,
            "unconverted_transaction_count": result.unconverted_count,
            "unconverted_account_count": unconverted_account_count,
            "accounts": account_balances,
        }


def get_top_merchants(
    user_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 10,
    category_id: Optional[str] = None,
    uncategorized: bool = False,
) -> list[dict]:
    """
    Get top merchants by total spending.

    Args:
        user_id: The user's ID
        from_date: Start date in ISO format (optional)
        to_date: End date in ISO format (optional)
        limit: Max number of merchants (default: 10, max: 50)
        category_id: Filter to transactions in this category (optional).
            Mutually exclusive with uncategorized.
        uncategorized: If True, return only transactions with no category.
            Mutually exclusive with category_id.

    Returns:
        List of merchants with total spending and transaction count
    """
    if category_id and uncategorized:
        raise ToolError("category_id and uncategorized are mutually exclusive.")

    cat_uuid = require_uuid(category_id, "category_id")
    limit = min(max(1, limit), 50)

    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)

    with get_db() as db:
        currency = user_currency(db, user_id)
        amount = functional_amount_expr(currency)
        query = db.query(
            Transaction.merchant,
            func.sum(func.abs(amount)).label("total"),
            func.count(Transaction.id).label("count"),
            func.count(Transaction.id).filter(amount.is_(None)).label("unconverted_count"),
        ).filter(
            Transaction.user_id == user_id,
            # 'debit', not `amount < 0`: every other aggregate in this module
            # keys off transaction_type, and the two definitions disagreed on
            # rows where the sign and the type don't match.
            Transaction.transaction_type == "debit",
            Transaction.merchant.isnot(None),
            Transaction.merchant != "",
            Transaction.include_in_analytics == True,
        )

        if cat_uuid:
            query = query.filter(
                or_(
                    Transaction.category_id == cat_uuid,
                    and_(
                        Transaction.category_id.is_(None),
                        Transaction.category_system_id == cat_uuid,
                    ),
                )
            )

        if uncategorized:
            query = query.filter(
                Transaction.category_id.is_(None),
                Transaction.category_system_id.is_(None),
            )

        if from_dt:
            query = query.filter(Transaction.booked_at >= from_dt)

        if to_dt:
            query = query.filter(Transaction.booked_at < to_dt)

        results = (
            query.group_by(Transaction.merchant)
            .order_by(func.sum(func.abs(amount)).desc().nullslast())
            .limit(limit)
            .all()
        )

        return [
            {
                "merchant": r.merchant,
                "total": float(r.total) if r.total else 0,
                "currency": currency,
                "count": r.count,
                "unconverted_transaction_count": r.unconverted_count,
            }
            for r in results
        ]
