"""Deterministic cash-flow / balance projection engine.

Pure functions only — no DB access here, mirroring pnl_service.py's split
(callers gather data from SQLAlchemy, this module just does math). A
forecast combines two legs:

  1. "known" — active RecurringTransaction rows, walked forward via
     compute_next_due_date(). These are currently always outflows: see
     tasks/recurring_transaction_tasks.py, where materialization always
     creates a debit (`amount=_quantize(-abs(recurring.amount))`). So each
     occurrence here is treated as a negative amount too, matching what will
     actually post to the account.
  2. "variable" — everything else, projected forward as a flat trailing
     daily average (see routes/forecast.py for how that average is
     computed, excluding transactions already linked to a recurring
     definition to avoid double-counting them).

Both legs are summed into a single daily cumulative balance series starting
from the current summed account balance. No confidence band — a single
projected line, per product decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from app.services.recurring_transaction_schedule_service import compute_next_due_date


@dataclass(frozen=True)
class RecurringDefinition:
    frequency: str
    amount: Decimal  # positive magnitude, as stored on RecurringTransaction
    next_due_date: date
    end_date: Optional[date] = None


@dataclass(frozen=True)
class ForecastPoint:
    day: date
    projected_balance: Decimal


@dataclass(frozen=True)
class ForecastResult:
    series: list[ForecastPoint]
    starting_balance: Decimal
    projected_balance_at_horizon: Decimal
    projected_net_cash_flow: Decimal
    projected_income: Decimal
    projected_expenses: Decimal


def _recurring_occurrences(
    recurring: list[RecurringDefinition], start: date, end: date
) -> dict[date, Decimal]:
    """Map day -> signed amount contributed by recurring definitions landing in [start, end]."""
    occurrences: dict[date, Decimal] = {}
    for r in recurring:
        due = r.next_due_date
        # next_due_date can be in the past if the daily beat tick hasn't
        # materialized it yet — walk forward to the first occurrence in range.
        while due < start:
            due = compute_next_due_date(r.frequency, due)
        while due <= end:
            if r.end_date and due > r.end_date:
                break
            occurrences[due] = occurrences.get(due, Decimal("0")) - abs(r.amount)
            due = compute_next_due_date(r.frequency, due)
    return occurrences


def project_cash_flow(
    *,
    starting_balance: Decimal,
    recurring: list[RecurringDefinition],
    trailing_daily_net: Decimal,
    horizon_days: int,
    as_of: Optional[date] = None,
) -> ForecastResult:
    """Project daily balance forward `horizon_days` days from `as_of` (default today).

    `trailing_daily_net` is the average daily net (income - expenses) from
    non-recurring-linked transactions over some trailing history window,
    computed by the caller and passed in as a single number so this
    function stays DB-free and easy to unit test.
    """
    if horizon_days <= 0:
        raise ValueError("horizon_days must be positive")

    start = as_of or date.today()
    end = start + timedelta(days=horizon_days)
    recurring_by_day = _recurring_occurrences(recurring, start + timedelta(days=1), end)

    series: list[ForecastPoint] = [ForecastPoint(day=start, projected_balance=starting_balance)]
    balance = starting_balance
    projected_income = Decimal("0")
    projected_expenses = Decimal("0")

    day = start
    while day < end:
        day = day + timedelta(days=1)
        day_net = trailing_daily_net + recurring_by_day.get(day, Decimal("0"))
        if day_net > 0:
            projected_income += day_net
        else:
            projected_expenses += -day_net
        balance += day_net
        series.append(ForecastPoint(day=day, projected_balance=balance))

    return ForecastResult(
        series=series,
        starting_balance=starting_balance,
        projected_balance_at_horizon=balance,
        projected_net_cash_flow=balance - starting_balance,
        projected_income=projected_income,
        projected_expenses=projected_expenses,
    )
