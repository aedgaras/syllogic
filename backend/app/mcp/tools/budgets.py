"""Budget tools for the MCP server.

Budgets are user-defined spending limits spanning one or more categories,
evaluated against the *current* period (monthly/weekly/yearly). The spend
math here deliberately mirrors the web app's implementation
(`frontend/features/budgets/domain/*` + `frontend/lib/actions/budgets.ts`)
so an agent and the UI never disagree about how much of a budget is used:

- Spend counts debit transactions whose effective category (user override
  `category_id`, else AI-assigned `category_system_id`) is in the budget.
- Transfers are excluded from spend via `include_in_analytics=False`, except
  for the `savings_transfer` / `investment_transfer` system categories: a
  budget built on those is explicitly meant to track outgoing transfers.
- Transaction spend is summed in the user's functional currency, then
  converted into the budget's own currency before any comparison, because a
  budget's `amount`/`sub_limit` are entered in the budget's currency.

Failures raise ToolError; a returned value means the write happened.
get_db() does not auto-rollback, so every mutation path still rolls back
explicitly before raising.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.mcp.dependencies import get_db, require_uuid, validate_uuid
from app.mcp.errors import (
    invalid_enum,
    invalid_format,
    missing_argument,
    not_found,
    out_of_range,
    raise_database_error,
)
from app.mcp.tools._currency import convert as _convert, user_currency as _user_currency
from app.mcp.tools._writes import mutation_result, preview_or_commit, remember, replay, snapshot
from app.models import (
    Budget,
    BudgetCategory,
    Category,
    Transaction,
)

# Thresholds mirror frontend/features/budgets/domain/status.ts
NEAR_LIMIT_THRESHOLD = 80.0
OVER_THRESHOLD = 100.0

VALID_PERIODS = ("monthly", "weekly", "yearly")

VALID_SET_MODES = ("replace", "add", "remove")

# Mirrors TRANSFER_SPEND_BYPASS_KEYS in frontend/lib/actions/budgets.ts.
TRANSFER_SPEND_BYPASS_KEYS = ("savings_transfer", "investment_transfer")

# Hard cap on how many categories one budget may carry, so a runaway agent
# call can't insert thousands of rows in a single mutation.
MAX_BUDGET_CATEGORIES = 100

# The budget's own fields, as update_budget can change them. Snapshotted
# before and after so a write that changes nothing says so.
EDITABLE_FIELDS = ("name", "amount", "currency", "period", "start_date", "is_active")


# ============================================================================
# Period math (mirrors frontend/features/budgets/domain/period.ts)
# ============================================================================


def _start_of_month(moment: datetime) -> datetime:
    return moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _add_months(moment: datetime, months: int) -> datetime:
    total = moment.month - 1 + months
    year = moment.year + total // 12
    month = total % 12 + 1
    day = min(moment.day, monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def _period_range(
    period: str,
    start_date: Optional[date],
    now: datetime,
    offset: int = 0,
) -> tuple[datetime, datetime]:
    """Half-open range [start, end) for a budget period.

    `offset` shifts whole periods backwards (0 = current, 1 = previous, ...),
    which is what get_budget_history walks over.
    """
    if period == "weekly":
        # Anchor the week on start_date's weekday, else Monday -- date-fns
        # `weekStartsOn` is 0=Sunday, Python's weekday() is 0=Monday, so the
        # comparison is done in Python's own numbering throughout.
        week_starts_on = start_date.weekday() if start_date else 0
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        delta = (midnight.weekday() - week_starts_on) % 7
        start = midnight - timedelta(days=delta + 7 * offset)
        return start, start + timedelta(days=7)

    if period == "yearly":
        start = now.replace(
            year=now.year - offset, month=1, day=1, hour=0, minute=0, second=0, microsecond=0
        )
        return start, start.replace(year=start.year + 1)

    # monthly (default)
    start = _add_months(_start_of_month(now), -offset)
    return start, _add_months(start, 1)


def _days_in_range(start: datetime, end: datetime) -> int:
    return (end.date() - start.date()).days


def _days_elapsed(start: datetime, end: datetime, now: datetime) -> int:
    """Days elapsed so far, inclusive of today, clamped to the period length."""
    return min((now.date() - start.date()).days + 1, _days_in_range(start, end))


# ============================================================================
# Status / pace (mirrors domain/status.ts and domain/pace.ts)
# ============================================================================


def _status(spent: float, amount: float) -> str:
    percentage = (spent / amount) * 100 if amount > 0 else 0.0
    if percentage > OVER_THRESHOLD:
        return "over_budget"
    if percentage >= NEAR_LIMIT_THRESHOLD:
        return "near_limit"
    return "on_track"


def _project_pace(
    spent_so_far: float, days_elapsed: int, days_in_period: int, amount: float
) -> tuple[float, str]:
    """Extrapolate today's daily spend rate to the end of the period."""
    if days_elapsed <= 0 or days_in_period <= 0:
        return spent_so_far, _status(spent_so_far, amount)
    projected = (spent_so_far / days_elapsed) * days_in_period
    return projected, _status(projected, amount)


# ============================================================================
# Spend queries
# ============================================================================


def _spend_eligibility():
    """Transfers are excluded from spend unless the category is a savings or
    investment transfer, which a budget may legitimately track."""
    return or_(
        Transaction.include_in_analytics.is_(True),
        Category.system_key.in_(TRANSFER_SPEND_BYPASS_KEYS),
    )


def _effective_category_id():
    """User override wins over the AI-assigned category."""
    return func.coalesce(Transaction.category_id, Transaction.category_system_id)


def _spend_by_category(
    db: Session,
    user_id: str,
    budget_ids: list[UUID],
    start: datetime,
    end: datetime,
) -> dict[tuple[UUID, UUID], float]:
    """Spend per (budget_id, category_id) over one period range."""
    if not budget_ids:
        return {}

    rows = (
        db.query(
            BudgetCategory.budget_id,
            BudgetCategory.category_id,
            func.coalesce(func.sum(func.abs(Transaction.functional_amount)), 0).label("spent"),
        )
        .join(Transaction, _effective_category_id() == BudgetCategory.category_id)
        .join(Category, Category.id == BudgetCategory.category_id)
        .filter(
            BudgetCategory.budget_id.in_(budget_ids),
            Transaction.user_id == user_id,
            Transaction.transaction_type == "debit",
            _spend_eligibility(),
            Transaction.booked_at >= start,
            Transaction.booked_at < end,
        )
        .group_by(BudgetCategory.budget_id, BudgetCategory.category_id)
        .all()
    )
    return {(row[0], row[1]): float(row[2]) for row in rows}


def _unconverted_spend_count(
    db: Session,
    user_id: str,
    budget_id: UUID,
    start: datetime,
    end: datetime,
) -> int:
    """Spend-eligible rows this budget cannot count, for one period range.

    `_spend_by_category` sums ABS(functional_amount), and SUM skips NULLs --
    so a transaction that could not be converted into the user's functional
    currency contributes zero to spend and disappears without trace. That is
    the mirror image of the bug the analytics module had (there, unconverted
    rows were added at face value in the wrong currency); both leave the
    caller unable to tell a complete total from an incomplete one.

    Reported rather than repaired: the fix is a rate for the missing pair,
    which this module cannot conjure.
    """
    return (
        db.query(func.count(Transaction.id))
        .join(BudgetCategory, _effective_category_id() == BudgetCategory.category_id)
        .join(Category, Category.id == BudgetCategory.category_id)
        .filter(
            BudgetCategory.budget_id == budget_id,
            Transaction.user_id == user_id,
            Transaction.transaction_type == "debit",
            Transaction.functional_amount.is_(None),
            _spend_eligibility(),
            Transaction.booked_at >= start,
            Transaction.booked_at < end,
        )
        .scalar()
        or 0
    )


def _spend_for_budgets(
    db: Session, user_id: str, budgets: list[Budget], now: datetime
) -> dict[UUID, dict[UUID, float]]:
    """Per-budget, per-category spend for each budget's own current period.

    Budgets sharing a period range are queried together, so N budgets cost
    one query per distinct range rather than one query per budget.
    """
    groups: dict[tuple[datetime, datetime], list[UUID]] = {}
    for budget in budgets:
        key = _period_range(budget.period or "monthly", budget.start_date, now)
        groups.setdefault(key, []).append(budget.id)

    result: dict[UUID, dict[UUID, float]] = {b.id: {} for b in budgets}
    for (start, end), budget_ids in groups.items():
        for (budget_id, category_id), spent in _spend_by_category(
            db, user_id, budget_ids, start, end
        ).items():
            result[budget_id][category_id] = spent
    return result


# ============================================================================
# Serialization
# ============================================================================


def _to_float(value) -> Optional[float]:
    return float(value) if value is not None else None


def _serialize_budget(
    db: Session,
    budget: Budget,
    spend_by_category: dict[UUID, float],
    functional_currency: str,
    now: datetime,
    include_categories: bool = True,
) -> dict:
    budget_currency = budget.currency or "EUR"
    amount = float(budget.amount)
    period = budget.period or "monthly"
    start, end = _period_range(period, budget.start_date, now)
    days_total = _days_in_range(start, end)
    days_elapsed = _days_elapsed(start, end, now)

    spent = _convert(db, sum(spend_by_category.values()), functional_currency, budget_currency)
    percentage = (spent / amount) * 100 if amount > 0 else 0.0
    projected, projected_status = _project_pace(spent, days_elapsed, days_total, amount)
    remaining = amount - spent
    days_remaining = max(days_total - days_elapsed, 0)

    payload = {
        "id": str(budget.id),
        "name": budget.name,
        "amount": amount,
        "currency": budget_currency,
        "period": period,
        "start_date": budget.start_date.isoformat() if budget.start_date else None,
        "is_active": budget.is_active if budget.is_active is not None else True,
        "spent": round(spent, 2),
        "remaining": round(remaining, 2),
        "percentage": round(percentage, 2),
        "status": _status(spent, amount),
        "projected_spend": round(projected, 2),
        "projected_status": projected_status,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "days_elapsed": days_elapsed,
        "days_remaining": days_remaining,
        # What the user can spend per remaining day and still land on budget.
        # None once the period is over, where "per day" has no meaning.
        "daily_allowance_remaining": (
            round(remaining / days_remaining, 2) if days_remaining > 0 else None
        ),
        "created_at": budget.created_at.isoformat() if budget.created_at else None,
        "updated_at": budget.updated_at.isoformat() if budget.updated_at else None,
        # Spend-eligible transactions missing a functional_amount. Non-zero
        # means `spent` is an undercount, not a total.
        "unconverted_transaction_count": _unconverted_spend_count(
            db, budget.user_id, budget.id, start, end
        ),
    }

    if include_categories:
        payload["categories"] = [
            _serialize_budget_category(
                db, bc, spend_by_category, functional_currency, budget_currency, amount
            )
            for bc in sorted(budget.budget_categories, key=lambda bc: bc.category.name or "")
        ]
    else:
        payload["category_count"] = len(budget.budget_categories)

    return payload


def _serialize_budget_category(
    db: Session,
    bc: BudgetCategory,
    spend_by_category: dict[UUID, float],
    functional_currency: str,
    budget_currency: str,
    budget_amount: float,
) -> dict:
    spent = _convert(
        db, spend_by_category.get(bc.category_id, 0.0), functional_currency, budget_currency
    )
    sub_limit = _to_float(bc.sub_limit)
    percentage = (spent / sub_limit) * 100 if sub_limit and sub_limit > 0 else 0.0
    weight = (
        (sub_limit / budget_amount) * 100 if sub_limit is not None and budget_amount > 0 else None
    )

    return {
        "category_id": str(bc.category_id),
        "category_name": bc.category.name if bc.category else None,
        "color": bc.category.color if bc.category else None,
        "sub_limit": sub_limit,
        "spent": round(spent, 2),
        "remaining": round(sub_limit - spent, 2) if sub_limit is not None else None,
        "percentage": round(percentage, 2),
        "status": "no_limit" if sub_limit is None else _status(spent, sub_limit),
        # Share of the parent budget this sub-limit represents.
        "weight": round(weight, 2) if weight is not None else None,
    }


def _load_budgets(db: Session, user_id: str, include_inactive: bool) -> list[Budget]:
    query = (
        db.query(Budget)
        .options(joinedload(Budget.budget_categories).joinedload(BudgetCategory.category))
        .filter(Budget.user_id == user_id)
    )
    if not include_inactive:
        query = query.filter(Budget.is_active.is_(True))
    return query.order_by(Budget.created_at.desc()).all()


def _load_budget(db: Session, user_id: str, budget_uuid: UUID) -> Optional[Budget]:
    return (
        db.query(Budget)
        .options(joinedload(Budget.budget_categories).joinedload(BudgetCategory.category))
        .filter(Budget.id == budget_uuid, Budget.user_id == user_id)
        .first()
    )


# ============================================================================
# Validation helpers
# ============================================================================


def _budget_candidates(db: Session, user_id: str) -> list[tuple[str, str]]:
    """(name, id) pairs for a not_found message.

    Takes the caller's session: the lookup that just missed already has one
    open, and a failed read should not cost a second connection.
    """
    return [
        (name, str(bid))
        for bid, name in db.query(Budget.id, Budget.name)
        .filter(Budget.user_id == user_id)
        .order_by(Budget.name)
        .all()
    ]


def _validate_period(period: str) -> None:
    if period not in VALID_PERIODS:
        raise invalid_enum("period", period, VALID_PERIODS)


def _validate_amount(amount: float) -> None:
    if amount is None or amount <= 0:
        raise out_of_range("amount", amount, minimum="greater than 0")


def _parse_start_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise invalid_format("start_date", value, "a date as YYYY-MM-DD", example="2026-09-01")


def _normalize_category_inputs(
    db: Session, user_id: str, entries: list[dict]
) -> list[tuple[UUID, Optional[Decimal]]]:
    """Validate {category_id, sub_limit} entries and confirm ownership.

    Raises on the first bad entry. Ownership is checked in one query rather
    than per entry, and duplicates are rejected outright because
    budget_categories is keyed on (budget_id, category_id) -- silently
    collapsing them would lose whichever sub_limit came second.
    """
    if entries is None:
        return []
    if len(entries) > MAX_BUDGET_CATEGORIES:
        raise out_of_range("categories length", len(entries), maximum=MAX_BUDGET_CATEGORIES)

    normalized: list[tuple[UUID, Optional[Decimal]]] = []
    seen: set[UUID] = set()

    for entry in entries:
        if isinstance(entry, str):
            entry = {"category_id": entry}
        if not isinstance(entry, dict):
            raise invalid_format(
                "categories entry",
                entry,
                'an object {"category_id": str, "sub_limit": float | null}',
            )

        raw_id = entry.get("category_id")
        if not raw_id:
            raise missing_argument("categories[].category_id", "every entry needs a category id")
        category_uuid = require_uuid(raw_id, "categories[].category_id")
        if category_uuid in seen:
            raise invalid_format(
                "categories",
                raw_id,
                "each category_id to appear once; a budget holds one sub_limit per category",
            )
        seen.add(category_uuid)

        sub_limit = entry.get("sub_limit")
        if sub_limit is None:
            normalized.append((category_uuid, None))
            continue
        try:
            sub_limit_value = Decimal(str(sub_limit))
        except (ValueError, ArithmeticError):
            raise invalid_format(
                f"sub_limit for category {raw_id}", sub_limit, "a number", example="150.00"
            ) from None
        if sub_limit_value <= 0:
            raise out_of_range(
                f"sub_limit for category {raw_id}", sub_limit, minimum="greater than 0"
            )
        normalized.append((category_uuid, sub_limit_value))

    if normalized:
        owned = {
            row[0]
            for row in db.query(Category.id)
            .filter(Category.id.in_([c for c, _ in normalized]), Category.user_id == user_id)
            .all()
        }
        missing = [str(c) for c, _ in normalized if c not in owned]
        if missing:
            raise not_found(
                "category",
                ", ".join(missing),
                candidates=[
                    (name, str(cid))
                    for cid, name in db.query(Category.id, Category.name)
                    .filter(Category.user_id == user_id)
                    .order_by(Category.name)
                    .all()
                ],
                tool="list_categories",
            )

    return normalized


# ============================================================================
# Read tools
# ============================================================================


def list_budgets(
    user_id: str,
    include_inactive: bool = True,
    include_categories: bool = True,
) -> list[dict]:
    """
    List budgets with current-period spend, status, and pace projection.

    Args:
        user_id: The user's ID
        include_inactive: Include budgets marked inactive (default True)
        include_categories: Include the per-category breakdown on each budget.
            Set False for a compact overview.

    Returns:
        List of budget dicts, newest first.
    """
    now = datetime.now()
    with get_db() as db:
        budgets = _load_budgets(db, user_id, include_inactive)
        if not budgets:
            return []
        functional_currency = _user_currency(db, user_id)
        spend = _spend_for_budgets(db, user_id, budgets, now)
        return [
            _serialize_budget(
                db, b, spend.get(b.id, {}), functional_currency, now, include_categories
            )
            for b in budgets
        ]


def get_budget(user_id: str, budget_id: str) -> dict | None:
    """
    Get one budget with its full per-category breakdown.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID

    Returns:
        Budget dict, or None if not found.
    """
    budget_uuid = validate_uuid(budget_id)
    if not budget_uuid:
        return None

    now = datetime.now()
    with get_db() as db:
        budget = _load_budget(db, user_id, budget_uuid)
        if not budget:
            return None
        functional_currency = _user_currency(db, user_id)
        spend = _spend_for_budgets(db, user_id, [budget], now)
        return _serialize_budget(
            db, budget, spend.get(budget.id, {}), functional_currency, now, True
        )


def get_budget_summary(user_id: str) -> dict:
    """
    Portfolio-level view of every active budget, in the user's functional currency.

    Args:
        user_id: The user's ID

    Returns:
        Dict with totals, counts, the attention list (over/near limit or
        projected to bust), and a compact row per active budget.
    """
    now = datetime.now()
    with get_db() as db:
        functional_currency = _user_currency(db, user_id)
        budgets = _load_budgets(db, user_id, include_inactive=False)
        if not budgets:
            return {
                "currency": functional_currency,
                "total_budgeted": 0.0,
                "total_spent": 0.0,
                "total_remaining": 0.0,
                "active_count": 0,
                "over_budget_count": 0,
                "near_limit_count": 0,
                "projected_over_count": 0,
                "budgets": [],
                "needs_attention": [],
            }

        spend = _spend_for_budgets(db, user_id, budgets, now)
        rows = [
            _serialize_budget(
                db, b, spend.get(b.id, {}), functional_currency, now, include_categories=False
            )
            for b in budgets
        ]

        # Each budget carries its own currency; totals are a single aggregate,
        # so convert every side into the functional currency before summing.
        total_budgeted = sum(
            _convert(db, r["amount"], r["currency"], functional_currency) for r in rows
        )
        total_spent = sum(
            _convert(db, r["spent"], r["currency"], functional_currency) for r in rows
        )

        compact = [
            {
                "id": r["id"],
                "name": r["name"],
                "amount": r["amount"],
                "currency": r["currency"],
                "period": r["period"],
                "spent": r["spent"],
                "remaining": r["remaining"],
                "percentage": r["percentage"],
                "status": r["status"],
                "projected_status": r["projected_status"],
            }
            for r in rows
        ]

        return {
            "currency": functional_currency,
            "total_budgeted": round(total_budgeted, 2),
            "total_spent": round(total_spent, 2),
            "total_remaining": round(total_budgeted - total_spent, 2),
            "active_count": len(rows),
            "over_budget_count": sum(1 for r in rows if r["status"] == "over_budget"),
            "near_limit_count": sum(1 for r in rows if r["status"] == "near_limit"),
            "projected_over_count": sum(1 for r in rows if r["projected_status"] == "over_budget"),
            "budgets": compact,
            "needs_attention": [
                b
                for b in compact
                if b["status"] in ("over_budget", "near_limit")
                or b["projected_status"] == "over_budget"
            ],
        }


def get_budget_transactions(
    user_id: str,
    budget_id: str,
    limit: int = 50,
    period_offset: int = 0,
    category_id: Optional[str] = None,
) -> dict:
    """
    The transactions that make up a budget's spend, largest first.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID
        limit: Max transactions to return (1-200, default 50)
        period_offset: 0 = current period, 1 = previous, etc.
        category_id: Restrict to one of the budget's categories (optional)

    Returns:
        Dict with the period range, the transactions, and totals. Raises
        ToolError if the budget or category isn't usable.
    """
    budget_uuid = require_uuid(budget_id, "budget_id")
    if period_offset < 0:
        raise out_of_range("period_offset", period_offset, minimum=0)
    limit = max(1, min(limit, 200))

    category_uuid = require_uuid(category_id, "category_id") if category_id else None

    now = datetime.now()
    with get_db() as db:
        budget = _load_budget(db, user_id, budget_uuid)
        if not budget:
            raise not_found(
                "budget",
                budget_id,
                candidates=_budget_candidates(db, user_id),
                tool="list_budgets",
            )

        budget_category_ids = [bc.category_id for bc in budget.budget_categories]
        if category_uuid is not None:
            if category_uuid not in budget_category_ids:
                raise not_found(
                    "category on this budget",
                    category_id,
                    candidates=[
                        (
                            bc.category.name if bc.category else str(bc.category_id),
                            str(bc.category_id),
                        )
                        for bc in budget.budget_categories
                    ],
                    tool="get_budget",
                )
            budget_category_ids = [category_uuid]

        start, end = _period_range(
            budget.period or "monthly", budget.start_date, now, period_offset
        )
        if not budget_category_ids:
            return {
                "budget_id": str(budget.id),
                "budget_name": budget.name,
                "period_start": start.isoformat(),
                "period_end": end.isoformat(),
                "transactions": [],
                "returned_count": 0,
                "total_count": 0,
                "total_spent": 0.0,
                "currency": budget.currency or "EUR",
                "has_more": False,
            }

        base = (
            db.query(Transaction)
            .join(Category, _effective_category_id() == Category.id)
            .filter(
                Transaction.user_id == user_id,
                Transaction.transaction_type == "debit",
                _effective_category_id().in_(budget_category_ids),
                _spend_eligibility(),
                Transaction.booked_at >= start,
                Transaction.booked_at < end,
            )
        )

        total_count = base.count()
        rows = (
            base.options(joinedload(Transaction.account))
            .order_by(func.abs(Transaction.functional_amount).desc().nullslast(), Transaction.id)
            .limit(limit)
            .all()
        )

        functional_currency = _user_currency(db, user_id)
        budget_currency = budget.currency or "EUR"
        spent_functional = sum(_spend_by_category(db, user_id, [budget.id], start, end).values())

        return {
            "budget_id": str(budget.id),
            "budget_name": budget.name,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "currency": budget_currency,
            "total_spent": round(
                _convert(db, spent_functional, functional_currency, budget_currency), 2
            ),
            "total_count": total_count,
            "returned_count": len(rows),
            "has_more": total_count > len(rows),
            "transactions": [
                {
                    "id": str(t.id),
                    "account_id": str(t.account_id),
                    "account_name": t.account.name if t.account else None,
                    "amount": float(t.amount),
                    "currency": t.currency,
                    "functional_amount": _to_float(t.functional_amount),
                    "description": t.description,
                    "merchant": t.merchant,
                    "category_id": str(t.category_id or t.category_system_id)
                    if (t.category_id or t.category_system_id)
                    else None,
                    "booked_at": t.booked_at.isoformat() if t.booked_at else None,
                }
                for t in rows
            ],
        }


def get_budget_history(user_id: str, budget_id: str, periods: int = 6) -> dict:
    """
    Spend for this budget over the last N periods, against its current limit.

    The limit compared against is today's `amount` -- historical limit
    changes are not versioned in the schema, so earlier periods are measured
    against what the budget costs now, not what it was set to then.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID
        periods: How many periods back to include, including the current one (1-24)

    Returns:
        Dict with one entry per period (most recent first) plus averages.
        Raises ToolError if the budget isn't found.
    """
    budget_uuid = require_uuid(budget_id, "budget_id")
    periods = max(1, min(periods, 24))

    now = datetime.now()
    with get_db() as db:
        budget = _load_budget(db, user_id, budget_uuid)
        if not budget:
            raise not_found(
                "budget",
                budget_id,
                candidates=_budget_candidates(db, user_id),
                tool="list_budgets",
            )

        functional_currency = _user_currency(db, user_id)
        budget_currency = budget.currency or "EUR"
        amount = float(budget.amount)
        period = budget.period or "monthly"

        entries = []
        for offset in range(periods):
            start, end = _period_range(period, budget.start_date, now, offset)
            spent = _convert(
                db,
                sum(_spend_by_category(db, user_id, [budget.id], start, end).values()),
                functional_currency,
                budget_currency,
            )
            entries.append(
                {
                    "period_start": start.isoformat(),
                    "period_end": end.isoformat(),
                    "is_current": offset == 0,
                    "spent": round(spent, 2),
                    "amount": amount,
                    "remaining": round(amount - spent, 2),
                    "percentage": round((spent / amount) * 100, 2) if amount > 0 else 0.0,
                    "status": _status(spent, amount),
                }
            )

        # The current period is partial, so it would drag any average down.
        # Averages and the breach count are computed over completed periods
        # only; the current period is still returned in `periods` for context.
        completed = [e for e in entries if not e["is_current"]]
        average_spent = (
            round(sum(e["spent"] for e in completed) / len(completed), 2) if completed else None
        )

        return {
            "budget_id": str(budget.id),
            "budget_name": budget.name,
            "period": period,
            "currency": budget_currency,
            "amount": amount,
            "periods": entries,
            "completed_period_count": len(completed),
            "average_spent_completed": average_spent,
            "over_budget_period_count": sum(1 for e in completed if e["status"] == "over_budget"),
            "suggested_amount": (
                # Average plus 10% headroom, rounded to whole units -- a
                # starting point for "what should this budget actually be?",
                # not an automatic change.
                float(round(average_spent * 1.1)) if average_spent else None
            ),
        }


# ============================================================================
# Mutation tools
# ============================================================================


def create_budget(
    user_id: str,
    name: str,
    amount: float,
    categories: Optional[list[dict]] = None,
    currency: str = "EUR",
    period: str = "monthly",
    start_date: Optional[str] = None,
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Create a budget.

    Args:
        user_id: The user's ID
        name: Budget name
        amount: Overall limit for the period, in `currency`
        categories: List of {"category_id": str, "sub_limit": float | None}
        currency: ISO currency code for amount/sub_limit (default EUR)
        period: monthly, weekly, or yearly
        start_date: YYYY-MM-DD anchor; only meaningful for weekly budgets,
            where it fixes which weekday the week rolls over on
        is_active: Whether the budget counts toward summaries (default True)
        dry_run: Build the budget, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. The same key
            with the same arguments replays the first response instead of
            creating a second budget; the same key with different arguments
            is rejected.

    Returns:
        {"budget": {...}, "dry_run": bool, "committed": bool}. Raises
        ToolError on invalid input.
    """
    if not name or not name.strip():
        raise missing_argument("name", "a budget needs a non-empty name")
    _validate_amount(amount)
    _validate_period(period)
    parsed_start = _parse_start_date(start_date)

    arguments = {
        "name": name,
        "amount": amount,
        "categories": categories,
        "currency": currency,
        "period": period,
        "start_date": start_date,
        "is_active": is_active,
    }

    now = datetime.now()
    with get_db() as db:
        # A dry run takes no key: it is a question, not a call to remember.
        stored, digest = replay(
            db, user_id, "create_budget", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        normalized = _normalize_category_inputs(db, user_id, categories or [])

        try:
            budget = Budget(
                user_id=user_id,
                name=name.strip(),
                amount=Decimal(str(amount)),
                currency=(currency or "EUR").upper(),
                period=period,
                start_date=parsed_start,
                is_active=is_active,
            )
            db.add(budget)
            db.flush()
            for category_uuid, sub_limit in normalized:
                db.add(
                    BudgetCategory(
                        budget_id=budget.id, category_id=category_uuid, sub_limit=sub_limit
                    )
                )

            def _built() -> dict:
                reloaded = _load_budget(db, user_id, budget.id)
                spend = _spend_for_budgets(db, user_id, [reloaded], now)
                return {
                    "budget": _serialize_budget(
                        db, reloaded, spend.get(reloaded.id, {}), _user_currency(db, user_id), now
                    ),
                }

            response = preview_or_commit(db, dry_run, _built)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("create_budget", e)

        if not dry_run:
            remember(db, user_id, "create_budget", idempotency_key, digest, response)
        return response


def update_budget(
    user_id: str,
    budget_id: str,
    name: Optional[str] = None,
    amount: Optional[float] = None,
    currency: Optional[str] = None,
    period: Optional[str] = None,
    start_date: Optional[str] = None,
    is_active: Optional[bool] = None,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Update a budget's own fields. Omitted fields keep their current value.

    Category membership is not touched here -- use set_budget_categories.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID
        name: New name (optional)
        amount: New overall limit, must be > 0 (optional)
        currency: New ISO currency code (optional). This re-denominates the
            budget: amount and sub_limits are interpreted in the new currency
            as-is, they are not converted.
        period: monthly, weekly, or yearly (optional)
        start_date: YYYY-MM-DD anchor, or "" to clear it (optional)
        is_active: Activate or deactivate the budget (optional)
        dry_run: Apply the change, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe (see create_budget)

    Returns:
        {"changed", "before", "after", "fields_changed", "budget", "dry_run",
        "committed"}. `changed` is False when every field was already the
        value asked for. Raises ToolError on invalid input or an unknown
        budget_id.
    """
    budget_uuid = require_uuid(budget_id, "budget_id")

    if all(v is None for v in (name, amount, currency, period, start_date, is_active)):
        raise missing_argument("fields to update", "pass at least one field to change")

    if name is not None and not name.strip():
        raise missing_argument("name", "a budget needs a non-empty name")
    if amount is not None:
        _validate_amount(amount)
    if period is not None:
        _validate_period(period)

    parsed_start = _parse_start_date(start_date) if start_date else None

    arguments = {
        "budget_id": budget_id,
        "name": name,
        "amount": amount,
        "currency": currency,
        "period": period,
        "start_date": start_date,
        "is_active": is_active,
    }

    now = datetime.now()
    with get_db() as db:
        stored, digest = replay(
            db, user_id, "update_budget", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        budget = _load_budget(db, user_id, budget_uuid)
        if not budget:
            raise not_found(
                "budget",
                budget_id,
                candidates=_budget_candidates(db, user_id),
                tool="list_budgets",
            )

        before = snapshot(budget, EDITABLE_FIELDS)

        try:
            if name is not None:
                budget.name = name.strip()
            if amount is not None:
                budget.amount = Decimal(str(amount))
            if currency is not None:
                budget.currency = currency.upper()
            if period is not None:
                budget.period = period
            if start_date is not None:
                # "" clears the anchor, a date sets it.
                budget.start_date = parsed_start
            if is_active is not None:
                budget.is_active = is_active

            def _updated() -> dict:
                reloaded = _load_budget(db, user_id, budget_uuid)
                spend = _spend_for_budgets(db, user_id, [reloaded], now)
                return mutation_result(
                    before,
                    snapshot(reloaded, EDITABLE_FIELDS),
                    budget=_serialize_budget(
                        db, reloaded, spend.get(reloaded.id, {}), _user_currency(db, user_id), now
                    ),
                )

            response = preview_or_commit(db, dry_run, _updated)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("update_budget", e)

        if not dry_run:
            remember(db, user_id, "update_budget", idempotency_key, digest, response)
        return response


def set_budget_categories(
    user_id: str,
    budget_id: str,
    categories: list[dict],
    mode: str = "replace",
    dry_run: bool = False,
) -> dict:
    """
    Reorganize which categories a budget covers, and their sub-limits.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID
        categories: For replace/add, a list of
            {"category_id": str, "sub_limit": float | None}. For remove, the
            sub_limit is ignored and only category_id is read.
        mode: "replace" (the list becomes the whole membership), "add"
            (insert new categories, update sub_limits of ones already
            present), or "remove" (drop the listed categories).
        dry_run: Apply the change, report it, then roll it back (default False)

    Returns:
        {"budget": {...}, "added": [...], "removed": [...],
         "updated": [...]}. Raises ToolError on invalid input or an unknown
        budget_id.
    """
    budget_uuid = require_uuid(budget_id, "budget_id")
    if mode not in VALID_SET_MODES:
        raise invalid_enum("mode", mode, VALID_SET_MODES)
    if categories is None:
        raise missing_argument("categories", "pass a list, or [] with mode='replace' to clear")
    if not categories and mode != "replace":
        raise missing_argument(
            "categories",
            f"mode={mode} needs at least one entry; only mode='replace' accepts an empty list",
        )

    now = datetime.now()
    with get_db() as db:
        budget = _load_budget(db, user_id, budget_uuid)
        if not budget:
            raise not_found(
                "budget",
                budget_id,
                candidates=_budget_candidates(db, user_id),
                tool="list_budgets",
            )

        normalized = _normalize_category_inputs(db, user_id, categories)

        existing = {bc.category_id: bc for bc in budget.budget_categories}
        requested = {category_uuid: sub_limit for category_uuid, sub_limit in normalized}
        added, removed, updated = [], [], []

        try:
            if mode == "remove":
                for category_uuid in requested:
                    bc = existing.get(category_uuid)
                    if bc is not None:
                        db.delete(bc)
                        removed.append(str(category_uuid))
            else:
                if mode == "replace":
                    for category_uuid, bc in existing.items():
                        if category_uuid not in requested:
                            db.delete(bc)
                            removed.append(str(category_uuid))
                    if len(requested) > MAX_BUDGET_CATEGORIES:
                        db.rollback()
                        raise out_of_range(
                            "categories length",
                            len(requested),
                            maximum=MAX_BUDGET_CATEGORIES,
                        )
                elif len(set(existing) | set(requested)) > MAX_BUDGET_CATEGORIES:
                    db.rollback()
                    raise out_of_range(
                        "resulting category count",
                        len(set(existing) | set(requested)),
                        maximum=MAX_BUDGET_CATEGORIES,
                    )

                for category_uuid, sub_limit in requested.items():
                    bc = existing.get(category_uuid)
                    if bc is None:
                        db.add(
                            BudgetCategory(
                                budget_id=budget.id,
                                category_id=category_uuid,
                                sub_limit=sub_limit,
                            )
                        )
                        added.append(str(category_uuid))
                    elif bc.sub_limit != sub_limit:
                        bc.sub_limit = sub_limit
                        updated.append(str(category_uuid))

            def _membership() -> dict:
                reloaded = _load_budget(db, user_id, budget_uuid)
                spend = _spend_for_budgets(db, user_id, [reloaded], now)
                return {
                    "changed": bool(added or removed or updated),
                    "added": added,
                    "removed": removed,
                    "updated": updated,
                    "budget": _serialize_budget(
                        db, reloaded, spend.get(reloaded.id, {}), _user_currency(db, user_id), now
                    ),
                }

            return preview_or_commit(db, dry_run, _membership)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("set_budget_categories", e)


def delete_budget(user_id: str, budget_id: str, dry_run: bool = False) -> dict:
    """
    Permanently delete a budget and its category memberships.

    Transactions are untouched -- a budget is only a lens over them.

    Args:
        user_id: The user's ID
        budget_id: The budget's ID
        dry_run: Report what would be destroyed without destroying it
            (default False)

    Returns:
        {"deleted_budget": {...}, "dry_run": bool, "committed": bool}. Raises
        ToolError if the budget isn't found.
    """
    budget_uuid = require_uuid(budget_id, "budget_id")

    with get_db() as db:
        budget = (
            db.query(Budget).filter(Budget.id == budget_uuid, Budget.user_id == user_id).first()
        )
        if not budget:
            raise not_found(
                "budget",
                budget_id,
                candidates=_budget_candidates(db, user_id),
                tool="list_budgets",
            )

        # Captured before the delete, and naming the category memberships
        # that go with it -- those cascade, and "what am I about to lose"
        # is the whole question a dry run on a delete is asked to answer.
        doomed = {
            "id": str(budget.id),
            "name": budget.name,
            "amount": float(budget.amount),
            "currency": budget.currency or "EUR",
            "category_ids": [str(bc.category_id) for bc in budget.budget_categories],
        }
        try:
            db.delete(budget)
            return preview_or_commit(db, dry_run, lambda: {"deleted_budget": doomed})
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("delete_budget", e)
