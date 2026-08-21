from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_helpers import get_user_id
from app.mcp.tools._asset_class import account_type_to_asset_class
from app.models import Account, AccountBalance, Category, RecurringTransaction, Transaction
from app.services.forecast_service import (
    RecurringDefinition,
    project_cash_flow,
    project_compounding_balance,
)

router = APIRouter()

# Window used to estimate the flat daily average (and its stddev) for
# non-recurring ("variable") spend/income on cash accounts — long enough to
# smooth out a single noisy month, short enough to react to a real change
# in habits.
_TRAILING_HISTORY_DAYS = 90

# Window + minimum coverage used to derive a flat daily growth rate for
# investment/crypto accounts from historical AccountBalance snapshots.
# Kept low deliberately: daily_investment_sync_all only writes one
# AccountBalance row per account per day, so a 30-row floor would make the
# growth leg unconditionally 0 for a full month after every account is
# added (or after the sync pipeline itself is rebuilt, as it was recently)
# — long enough that it reads as permanently broken rather than "still
# warming up".
_GROWTH_HISTORY_DAYS = 180
_MIN_GROWTH_HISTORY_ROWS = 5

_GROWTH_ASSET_CLASSES = {"investment", "crypto"}


def _is_growth_account(account_type: Optional[str]) -> bool:
    return account_type_to_asset_class(account_type) in _GROWTH_ASSET_CLASSES


def _finite_decimal(value: Optional[Decimal]) -> Decimal:
    """Coerce a stored balance to a finite Decimal, treating NaN/Infinity as 0.

    Numeric DB columns can hold NaN/Infinity (Postgres allows it), and
    Decimal silently propagates those through +/-/* without raising —
    unlike comparisons, which raise InvalidOperation. Left unchecked, one
    corrupt balance turns the whole projection (and every point in the
    chart) into NaN. Values are guarded once here, at the DB boundary,
    instead of at every downstream arithmetic op.
    """
    if value is None or not value.is_finite():
        return Decimal("0")
    return value


@router.get("/cashflow")
def get_cashflow_forecast(
    horizon_days: int = Query(30, ge=1, le=365),
    account_ids: Optional[list[UUID]] = Query(None),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Project daily account balance forward, plus a savings summary.

    Combines three legs: known future amounts from active recurring
    transactions, a flat trailing-average (with a confidence band) for
    everything else on cash accounts, and flat historical compounding for
    investment/crypto accounts. See app/services/forecast_service.py for
    the projection math.
    """
    accounts_query = db.query(Account).filter(Account.user_id == user_id, Account.is_active == True)
    if account_ids:
        accounts_query = accounts_query.filter(Account.id.in_(account_ids))
    accounts = accounts_query.all()

    cash_accounts = [a for a in accounts if not _is_growth_account(a.account_type)]
    growth_accounts = [a for a in accounts if _is_growth_account(a.account_type)]
    cash_account_ids = [a.id for a in cash_accounts]
    growth_account_ids = [a.id for a in growth_accounts]

    cash_starting_balance = sum(
        (_finite_decimal(a.functional_balance) for a in cash_accounts), Decimal("0")
    )
    growth_starting_balance = sum(
        (_finite_decimal(a.functional_balance) for a in growth_accounts), Decimal("0")
    )

    # --- Known leg: active recurring transactions on cash accounts only.
    # A recurring row on a growth account (e.g. a scheduled brokerage
    # contribution) is left to the compounding leg instead, so it isn't
    # double-counted. Rows with no account_id stay on the cash leg (they
    # never actually materialize either way — check_due_recurring_transactions
    # requires a non-null account_id — but that's an existing, unrelated
    # inconsistency, not something to paper over here).
    recurring_query = (
        db.query(RecurringTransaction, Category.category_type)
        .outerjoin(Category, RecurringTransaction.category_id == Category.id)
        .filter(
            RecurringTransaction.user_id == user_id,
            RecurringTransaction.is_active == True,
            RecurringTransaction.next_due_date.isnot(None),
        )
    )
    if account_ids:
        # An explicit account filter already resolved to cash-type accounts
        # only, so this both narrows to the requested accounts and excludes
        # growth accounts in one step. Rows with a null account_id are
        # dropped here too — same as the account-filter behavior before this
        # change.
        recurring_query = recurring_query.filter(
            RecurringTransaction.account_id.in_(cash_account_ids)
        )
    elif growth_account_ids:
        # No account filter: keep everything except rows explicitly tied to
        # a growth account. Rows with a null account_id must be kept — NOT
        # IN with a NULL column value evaluates to NULL/false in SQL, so it
        # has to be spelled out explicitly rather than relying on `~in_()`.
        recurring_query = recurring_query.filter(
            or_(
                RecurringTransaction.account_id.is_(None),
                ~RecurringTransaction.account_id.in_(growth_account_ids),
            )
        )
    recurring = [
        RecurringDefinition(
            frequency=r.frequency,
            amount=r.amount,
            next_due_date=r.next_due_date,
            end_date=r.end_date,
            is_income=(category_type == "income"),
        )
        for r, category_type in recurring_query.all()
    ]

    # --- Variable leg: trailing daily net (mean + stddev) from non-recurring
    # transactions on cash accounts only.
    history_start = date.today() - timedelta(days=_TRAILING_HISTORY_DAYS)
    daily_rows = []
    if cash_account_ids:
        daily_rows = (
            db.query(
                func.date(Transaction.booked_at).label("day"), func.sum(Transaction.functional_amount)
            )
            .filter(
                Transaction.user_id == user_id,
                Transaction.include_in_analytics == True,
                Transaction.recurring_transaction_id.is_(None),
                Transaction.booked_at >= history_start,
                Transaction.account_id.in_(cash_account_ids),
            )
            .group_by(func.date(Transaction.booked_at))
            .all()
        )
    daily_totals_by_day = {row[0]: _finite_decimal(Decimal(row[1] or 0)) for row in daily_rows}
    daily_nets = [
        daily_totals_by_day.get(history_start + timedelta(days=i), Decimal("0"))
        for i in range(_TRAILING_HISTORY_DAYS)
    ]
    trailing_daily_net = sum(daily_nets) / _TRAILING_HISTORY_DAYS
    variance = sum((n - trailing_daily_net) ** 2 for n in daily_nets) / _TRAILING_HISTORY_DAYS
    trailing_daily_stddev = variance.sqrt()

    cash_result = project_cash_flow(
        starting_balance=cash_starting_balance,
        recurring=recurring,
        trailing_daily_net=trailing_daily_net,
        trailing_daily_stddev=trailing_daily_stddev,
        horizon_days=horizon_days,
    )

    # --- Growth leg: flat daily rate derived from historical AccountBalance
    # appreciation. Falls back to 0% (flat) when there isn't enough history
    # to trust a rate, rather than folding growth accounts into the flat
    # transaction-average leg — market appreciation doesn't post as a
    # transaction, so that leg would just under-count it, not degrade
    # gracefully.
    growth_daily_rate = Decimal("0")
    if growth_account_ids and growth_starting_balance > 0:
        growth_history_start = date.today() - timedelta(days=_GROWTH_HISTORY_DAYS)
        balance_rows = (
            db.query(AccountBalance.date, func.sum(AccountBalance.balance_in_functional_currency))
            .filter(
                AccountBalance.account_id.in_(growth_account_ids),
                AccountBalance.date >= growth_history_start,
            )
            .group_by(AccountBalance.date)
            .order_by(AccountBalance.date.asc())
            .all()
        )
        if len(balance_rows) >= _MIN_GROWTH_HISTORY_ROWS:
            first_date, first_balance = balance_rows[0]
            last_date, last_balance = balance_rows[-1]
            first_balance = _finite_decimal(first_balance)
            last_balance = _finite_decimal(last_balance)
            span_days = (last_date - first_date).days
            if span_days > 0 and first_balance > 0 and last_balance > 0:
                growth_daily_rate = (last_balance / first_balance) ** (
                    Decimal(1) / span_days
                ) - 1

    growth_result = project_compounding_balance(
        starting_balance=growth_starting_balance,
        daily_rate=growth_daily_rate,
        horizon_days=horizon_days,
    )

    combined_series = [
        {
            "date": cash_point.day.isoformat(),
            "projectedBalance": float(cash_point.projected_balance + growth_point.balance),
            "low": float(cash_point.low + growth_point.balance),
            "high": float(cash_point.high + growth_point.balance),
        }
        for cash_point, growth_point in zip(cash_result.series, growth_result.series)
    ]

    return {
        "startingBalance": float(cash_result.starting_balance + growth_result.starting_balance),
        "cashStartingBalance": float(cash_result.starting_balance),
        "growthStartingBalance": float(growth_result.starting_balance),
        "projectedBalanceAtHorizon": float(
            cash_result.projected_balance_at_horizon + growth_result.balance_at_horizon
        ),
        "projectedBalanceLowAtHorizon": float(
            cash_result.projected_balance_low_at_horizon + growth_result.balance_at_horizon
        ),
        "projectedBalanceHighAtHorizon": float(
            cash_result.projected_balance_high_at_horizon + growth_result.balance_at_horizon
        ),
        "projectedNetCashFlow": float(
            (cash_result.projected_balance_at_horizon + growth_result.balance_at_horizon)
            - (cash_result.starting_balance + growth_result.starting_balance)
        ),
        "projectedIncome": float(cash_result.projected_income),
        "projectedExpenses": float(cash_result.projected_expenses),
        "growthProjectedChange": float(
            growth_result.balance_at_horizon - growth_result.starting_balance
        ),
        "series": combined_series,
    }
