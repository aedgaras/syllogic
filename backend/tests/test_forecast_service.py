"""Unit tests for the pure cash-flow projection engine."""

from datetime import date
from decimal import Decimal

import pytest

from app.services.forecast_service import RecurringDefinition, project_cash_flow


def test_project_cash_flow_no_data_holds_balance_flat():
    result = project_cash_flow(
        starting_balance=Decimal("1000"),
        recurring=[],
        trailing_daily_net=Decimal("0"),
        horizon_days=30,
        as_of=date(2026, 1, 1),
    )

    assert result.starting_balance == Decimal("1000")
    assert result.projected_balance_at_horizon == Decimal("1000")
    assert result.projected_net_cash_flow == Decimal("0")
    assert len(result.series) == 31  # inclusive of day 0
    assert result.series[0].day == date(2026, 1, 1)
    assert result.series[-1].day == date(2026, 1, 31)


def test_project_cash_flow_variable_leg_only():
    # -10/day for 10 days = -100 net.
    result = project_cash_flow(
        starting_balance=Decimal("500"),
        recurring=[],
        trailing_daily_net=Decimal("-10"),
        horizon_days=10,
        as_of=date(2026, 1, 1),
    )

    assert result.projected_balance_at_horizon == Decimal("400")
    assert result.projected_net_cash_flow == Decimal("-100")
    assert result.projected_expenses == Decimal("100")
    assert result.projected_income == Decimal("0")


def test_project_cash_flow_recurring_leg_is_always_an_outflow():
    # RecurringTransaction.amount is a positive magnitude; materialization
    # always creates a debit, so recurring occurrences must be negative
    # regardless of the sign supplied.
    recurring = [
        RecurringDefinition(
            frequency="monthly",
            amount=Decimal("50"),
            next_due_date=date(2026, 1, 15),
        )
    ]
    result = project_cash_flow(
        starting_balance=Decimal("1000"),
        recurring=recurring,
        trailing_daily_net=Decimal("0"),
        horizon_days=30,
        as_of=date(2026, 1, 1),
    )

    assert result.projected_balance_at_horizon == Decimal("950")
    day_15 = next(p for p in result.series if p.day == date(2026, 1, 15))
    assert day_15.projected_balance == Decimal("950")


def test_project_cash_flow_recurring_respects_end_date():
    recurring = [
        RecurringDefinition(
            frequency="weekly",
            amount=Decimal("20"),
            next_due_date=date(2026, 1, 3),
            end_date=date(2026, 1, 3),  # only the first occurrence should land
        )
    ]
    result = project_cash_flow(
        starting_balance=Decimal("100"),
        recurring=recurring,
        trailing_daily_net=Decimal("0"),
        horizon_days=30,
        as_of=date(2026, 1, 1),
    )

    assert result.projected_balance_at_horizon == Decimal("80")


def test_project_cash_flow_recurring_next_due_date_in_the_past_still_lands():
    # next_due_date can lag behind "today" if the daily beat tick hasn't
    # materialized it yet; the engine should walk forward to the next
    # in-range occurrence rather than skipping the definition entirely.
    recurring = [
        RecurringDefinition(
            frequency="monthly",
            amount=Decimal("30"),
            next_due_date=date(2025, 12, 1),
        )
    ]
    result = project_cash_flow(
        starting_balance=Decimal("100"),
        recurring=recurring,
        trailing_daily_net=Decimal("0"),
        horizon_days=60,
        as_of=date(2026, 1, 1),
    )

    # Next occurrence on/after 2026-01-01 is 2026-01-01 (Dec 1 -> Jan 1),
    # and the following one on 2026-02-01 also falls inside the 60-day horizon.
    assert result.projected_balance_at_horizon == Decimal("40")


def test_project_cash_flow_combines_income_and_expenses():
    result = project_cash_flow(
        starting_balance=Decimal("0"),
        recurring=[],
        trailing_daily_net=Decimal("5"),  # net positive: more income than expense
        horizon_days=1,
        as_of=date(2026, 1, 1),
    )

    assert result.projected_income == Decimal("5")
    assert result.projected_expenses == Decimal("0")


def test_project_cash_flow_rejects_non_positive_horizon():
    with pytest.raises(ValueError):
        project_cash_flow(
            starting_balance=Decimal("0"),
            recurring=[],
            trailing_daily_net=Decimal("0"),
            horizon_days=0,
        )
