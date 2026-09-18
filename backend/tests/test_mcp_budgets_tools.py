"""Tests for the budget MCP tools.

Covers the pure period/status/pace math (no database) and the read/mutate
tools against seeded budgets. The DB-backed tests need the scratch Postgres
described in tests/README.md.

Run with:
    cd backend && .venv/bin/pytest tests/test_mcp_budgets_tools.py -v
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.mcp.tools import budgets as budget_tools
from app.mcp.tools.budgets import (
    _days_elapsed,
    _days_in_range,
    _period_range,
    _project_pace,
    _status,
)
from app.models import Account, Budget, BudgetCategory, Category, Transaction, User


# ============================================================================
# Period / status / pace math -- no database
# ============================================================================


def test_monthly_range_is_the_calendar_month():
    start, end = _period_range("monthly", None, datetime(2026, 9, 18, 14, 30))
    assert start == datetime(2026, 9, 1)
    assert end == datetime(2026, 10, 1)


def test_monthly_offset_walks_back_across_a_year_boundary():
    start, end = _period_range("monthly", None, datetime(2026, 1, 15), offset=1)
    assert (start, end) == (datetime(2025, 12, 1), datetime(2026, 1, 1))


def test_yearly_range_ignores_start_date():
    start, end = _period_range("yearly", date(2020, 6, 5), datetime(2026, 9, 18))
    assert (start, end) == (datetime(2026, 1, 1), datetime(2027, 1, 1))


def test_weekly_defaults_to_monday_but_honors_the_start_date_weekday():
    now = datetime(2026, 9, 18, 14, 30)  # a Friday
    assert _period_range("weekly", None, now)[0] == datetime(2026, 9, 14)  # Monday
    # 2026-09-13 is a Sunday, so the week rolls over on Sundays.
    assert _period_range("weekly", date(2026, 9, 13), now)[0] == datetime(2026, 9, 13)


def test_weekly_offset_steps_back_one_week():
    now = datetime(2026, 9, 18)
    assert _period_range("weekly", None, now, offset=1)[0] == datetime(2026, 9, 7)


def test_days_elapsed_is_inclusive_of_today_and_clamped():
    start, end = _period_range("monthly", None, datetime(2026, 9, 18))
    assert _days_in_range(start, end) == 30
    assert _days_elapsed(start, end, datetime(2026, 9, 18)) == 18
    # A `now` past the period end can't report more days than the period has.
    assert _days_elapsed(start, end, datetime(2026, 11, 5)) == 30


def test_status_thresholds_match_the_web_app():
    assert _status(50, 100) == "on_track"
    assert _status(80, 100) == "near_limit"
    assert _status(100, 100) == "near_limit"  # exactly at the limit is not over
    assert _status(100.01, 100) == "over_budget"
    assert _status(5, 0) == "on_track"  # no limit set -> never "over"


def test_pace_extrapolates_the_daily_rate():
    projected, status = _project_pace(180, 18, 30, 300)
    assert projected == 300
    assert status == "near_limit"
    # Nothing to extrapolate from yet.
    assert _project_pace(50, 0, 30, 100) == (50, "on_track")


# ============================================================================
# DB-backed fixtures
# ============================================================================


@pytest.fixture
def budget_data(db_session):
    """One user with Groceries/Dining categories and spend in the current month."""
    user = User(id="budget-user", email="budget@test.com", functional_currency="EUR")
    db_session.add(user)
    account = Account(user_id=user.id, name="Checking", account_type="checking")
    db_session.add(account)
    db_session.flush()

    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    dining = Category(user_id=user.id, name="Dining", category_type="expense")
    db_session.add_all([groceries, dining])
    db_session.flush()

    # Anchor spend inside the current month so it lands in the live period,
    # while staying clear of both month boundaries.
    today = datetime.now().replace(hour=12, minute=0, second=0, microsecond=0)
    in_period = today.replace(day=min(today.day, 28))

    specs = [
        (groceries.id, -60, "debit", True),
        (groceries.id, -40, "debit", True),
        (dining.id, -30, "debit", True),
        # Excluded from spend: not analytics-eligible, wrong direction, or
        # in a category this budget doesn't cover.
        (groceries.id, -500, "debit", False),
        (dining.id, 25, "credit", True),
    ]
    for i, (category_id, amount, tx_type, in_analytics) in enumerate(specs):
        db_session.add(
            Transaction(
                user_id=user.id,
                account_id=account.id,
                amount=Decimal(str(amount)),
                functional_amount=Decimal(str(amount)),
                currency="EUR",
                description=f"Txn {i}",
                merchant=f"M{i}",
                category_id=category_id,
                booked_at=in_period,
                transaction_type=tx_type,
                include_in_analytics=in_analytics,
            )
        )

    # Spend in the previous month, for the history tool.
    last_month = (in_period.replace(day=1) - timedelta(days=1)).replace(hour=12)
    db_session.add(
        Transaction(
            user_id=user.id,
            account_id=account.id,
            amount=Decimal("-200"),
            functional_amount=Decimal("-200"),
            currency="EUR",
            description="Last month",
            merchant="Old",
            category_id=groceries.id,
            booked_at=last_month,
            transaction_type="debit",
            include_in_analytics=True,
        )
    )

    budget = Budget(
        user_id=user.id,
        name="Food",
        amount=Decimal("200.00"),
        currency="EUR",
        period="monthly",
        is_active=True,
    )
    db_session.add(budget)
    db_session.flush()
    db_session.add(
        BudgetCategory(budget_id=budget.id, category_id=groceries.id, sub_limit=Decimal("120.00"))
    )
    db_session.add(BudgetCategory(budget_id=budget.id, category_id=dining.id, sub_limit=None))
    db_session.commit()

    try:
        yield user, budget, groceries, dining
    finally:
        db_session.rollback()
        db_session.query(Transaction).filter(Transaction.user_id == user.id).delete()
        db_session.query(Budget).filter(Budget.user_id == user.id).delete()
        db_session.query(Category).filter(Category.user_id == user.id).delete()
        db_session.query(Account).filter(Account.user_id == user.id).delete()
        db_session.query(User).filter(User.id == user.id).delete()
        db_session.commit()


# ============================================================================
# Reads
# ============================================================================


def test_list_budgets_reports_spend_status_and_pace(budget_data):
    user, budget, groceries, _ = budget_data
    rows = budget_tools.list_budgets(user.id)
    assert len(rows) == 1

    row = rows[0]
    # 60 + 40 + 30; the credit, and the include_in_analytics=False debit, don't count.
    assert row["spent"] == 130.0
    assert row["remaining"] == 70.0
    assert row["percentage"] == 65.0
    assert row["status"] == "on_track"
    assert row["projected_status"] in ("on_track", "near_limit", "over_budget")
    assert row["days_elapsed"] >= 1

    by_category = {c["category_name"]: c for c in row["categories"]}
    assert by_category["Groceries"]["spent"] == 100.0
    assert by_category["Groceries"]["sub_limit"] == 120.0
    assert by_category["Groceries"]["status"] == "near_limit"  # 100/120 = 83%
    assert by_category["Dining"]["sub_limit"] is None
    assert by_category["Dining"]["status"] == "no_limit"


def test_list_budgets_compact_mode_drops_the_breakdown(budget_data):
    user, *_ = budget_data
    row = budget_tools.list_budgets(user.id, include_categories=False)[0]
    assert "categories" not in row
    assert row["category_count"] == 2


def test_list_budgets_can_exclude_inactive(budget_data):
    user, budget, *_ = budget_data
    budget_tools.update_budget(user.id, str(budget.id), is_active=False)
    assert budget_tools.list_budgets(user.id, include_inactive=False) == []
    assert len(budget_tools.list_budgets(user.id, include_inactive=True)) == 1


def test_get_budget_returns_none_for_unknown_or_malformed_id(budget_data):
    user, *_ = budget_data
    assert budget_tools.get_budget(user.id, "not-a-uuid") is None
    assert budget_tools.get_budget(user.id, "00000000-0000-0000-0000-000000000000") is None


def test_get_budget_is_scoped_to_the_caller(budget_data):
    _, budget, *_ = budget_data
    assert budget_tools.get_budget("someone-else", str(budget.id)) is None


def test_get_budget_summary_totals_and_attention_list(budget_data):
    user, budget, *_ = budget_data
    summary = budget_tools.get_budget_summary(user.id)
    assert summary["currency"] == "EUR"
    assert summary["active_count"] == 1
    assert summary["total_budgeted"] == 200.0
    assert summary["total_spent"] == 130.0
    assert summary["total_remaining"] == 70.0
    assert summary["over_budget_count"] == 0

    budget_tools.update_budget(user.id, str(budget.id), amount=100.0)
    summary = budget_tools.get_budget_summary(user.id)
    assert summary["over_budget_count"] == 1
    assert [b["id"] for b in summary["needs_attention"]] == [str(budget.id)]


def test_get_budget_transactions_reconciles_with_the_spend_total(budget_data):
    user, budget, *_ = budget_data
    result = budget_tools.get_budget_transactions(user.id, str(budget.id))
    assert result["total_count"] == 3
    assert result["total_spent"] == 130.0
    # Largest first.
    assert [abs(t["amount"]) for t in result["transactions"]] == [60.0, 40.0, 30.0]
    assert result["has_more"] is False


def test_get_budget_transactions_filters_to_one_category(budget_data):
    user, budget, groceries, dining = budget_data
    result = budget_tools.get_budget_transactions(
        user.id, str(budget.id), category_id=str(groceries.id)
    )
    assert result["total_count"] == 2

    unrelated = Category(user_id=user.id, name="Rent", category_type="expense")
    other = budget_tools.get_budget_transactions(
        user.id, str(budget.id), category_id="00000000-0000-0000-0000-000000000000"
    )
    assert other["error"] == "Category is not part of this budget"
    assert unrelated.name == "Rent"  # not persisted; guards against a stray commit


def test_get_budget_transactions_previous_period(budget_data):
    user, budget, *_ = budget_data
    result = budget_tools.get_budget_transactions(user.id, str(budget.id), period_offset=1)
    assert result["total_spent"] == 200.0
    assert result["total_count"] == 1


def test_get_budget_history_averages_completed_periods_only(budget_data):
    user, budget, *_ = budget_data
    history = budget_tools.get_budget_history(user.id, str(budget.id), periods=3)
    assert len(history["periods"]) == 3
    assert history["periods"][0]["is_current"] is True
    assert history["periods"][0]["spent"] == 130.0
    assert history["periods"][1]["spent"] == 200.0
    assert history["completed_period_count"] == 2
    # (200 + 0) / 2 completed periods -- the partial current one is excluded.
    assert history["average_spent_completed"] == 100.0
    assert history["over_budget_period_count"] == 0
    assert history["suggested_amount"] == 110.0


def test_get_budget_history_rejects_a_missing_budget(budget_data):
    user, *_ = budget_data
    assert "error" in budget_tools.get_budget_history(user.id, "nope")


# ============================================================================
# Mutations
# ============================================================================


def test_create_budget_with_categories_and_sub_limits(budget_data):
    user, _, groceries, _ = budget_data
    result = budget_tools.create_budget(
        user_id=user.id,
        name="  Groceries only  ",
        amount=150.0,
        categories=[{"category_id": str(groceries.id), "sub_limit": 150}],
        period="weekly",
        start_date="2026-09-13",
    )
    assert result["success"] is True
    created = result["budget"]
    assert created["name"] == "Groceries only"
    assert created["period"] == "weekly"
    assert created["start_date"] == "2026-09-13"
    assert created["categories"][0]["sub_limit"] == 150.0


def test_create_budget_rejects_bad_input(budget_data):
    user, _, groceries, _ = budget_data
    assert budget_tools.create_budget(user.id, "", 10.0)["error"] == "Name is required"
    assert "greater than 0" in budget_tools.create_budget(user.id, "X", 0)["error"]
    assert "period must be" in budget_tools.create_budget(user.id, "X", 10, period="daily")["error"]
    assert (
        "start_date"
        in budget_tools.create_budget(user.id, "X", 10, start_date="13/09/2026")["error"]
    )

    duplicate = budget_tools.create_budget(
        user.id,
        "X",
        10,
        categories=[{"category_id": str(groceries.id)}, {"category_id": str(groceries.id)}],
    )
    assert "Duplicate category_id" in duplicate["error"]


def test_create_budget_rejects_a_category_the_user_does_not_own(budget_data):
    user, *_ = budget_data
    result = budget_tools.create_budget(
        user.id,
        "X",
        10,
        categories=[{"category_id": "00000000-0000-0000-0000-000000000000"}],
    )
    assert result["success"] is False
    assert "Category not found" in result["error"]


def test_update_budget_only_touches_what_it_is_given(budget_data):
    user, budget, *_ = budget_data
    result = budget_tools.update_budget(user.id, str(budget.id), amount=400.0)
    assert result["success"] is True
    assert result["budget"]["amount"] == 400.0
    assert result["budget"]["name"] == "Food"
    assert result["budget"]["period"] == "monthly"
    # Spend is recomputed against the new limit.
    assert result["budget"]["percentage"] == 32.5
    assert len(result["budget"]["categories"]) == 2


def test_update_budget_clears_the_start_date_with_an_empty_string(budget_data):
    user, budget, *_ = budget_data
    budget_tools.update_budget(user.id, str(budget.id), start_date="2026-09-13")
    cleared = budget_tools.update_budget(user.id, str(budget.id), start_date="")
    assert cleared["budget"]["start_date"] is None


def test_update_budget_error_shapes(budget_data):
    user, budget, *_ = budget_data
    assert budget_tools.update_budget(user.id, str(budget.id))["error"] == "No fields to update"
    assert budget_tools.update_budget(user.id, "nope", amount=5)["error"] == (
        "Invalid budget ID format"
    )
    assert (
        budget_tools.update_budget(user.id, "00000000-0000-0000-0000-000000000000", amount=5)[
            "error"
        ]
        == "Budget not found"
    )
    assert (
        "greater than 0" in budget_tools.update_budget(user.id, str(budget.id), amount=-1)["error"]
    )


def test_set_budget_categories_replace_swaps_the_whole_membership(budget_data):
    user, budget, groceries, dining = budget_data
    result = budget_tools.set_budget_categories(
        user.id,
        str(budget.id),
        [{"category_id": str(dining.id), "sub_limit": 50}],
        mode="replace",
    )
    assert result["success"] is True
    assert result["removed"] == [str(groceries.id)]
    assert result["added"] == [] or result["updated"] == [str(dining.id)]
    names = [c["category_name"] for c in result["budget"]["categories"]]
    assert names == ["Dining"]
    assert result["budget"]["spent"] == 30.0


def test_set_budget_categories_add_inserts_and_relimits(budget_data):
    user, budget, groceries, _ = budget_data
    result = budget_tools.set_budget_categories(
        user.id,
        str(budget.id),
        [{"category_id": str(groceries.id), "sub_limit": 99}],
        mode="add",
    )
    assert result["updated"] == [str(groceries.id)]
    assert result["removed"] == []
    by_category = {c["category_name"]: c for c in result["budget"]["categories"]}
    assert by_category["Groceries"]["sub_limit"] == 99.0
    assert by_category["Dining"]["sub_limit"] is None  # untouched


def test_set_budget_categories_remove_drops_only_what_is_listed(budget_data):
    user, budget, groceries, _ = budget_data
    result = budget_tools.set_budget_categories(
        user.id, str(budget.id), [{"category_id": str(groceries.id)}], mode="remove"
    )
    assert result["removed"] == [str(groceries.id)]
    assert [c["category_name"] for c in result["budget"]["categories"]] == ["Dining"]
    assert result["budget"]["spent"] == 30.0


def test_set_budget_categories_error_shapes(budget_data):
    user, budget, groceries, _ = budget_data
    assert (
        "mode must be"
        in budget_tools.set_budget_categories(user.id, str(budget.id), [], mode="merge")["error"]
    )
    assert (
        "must not be empty"
        in budget_tools.set_budget_categories(user.id, str(budget.id), [], mode="add")["error"]
    )
    assert (
        budget_tools.set_budget_categories(
            user.id, "00000000-0000-0000-0000-000000000000", [{"category_id": str(groceries.id)}]
        )["error"]
        == "Budget not found"
    )
    assert (
        "sub_limit"
        in budget_tools.set_budget_categories(
            user.id, str(budget.id), [{"category_id": str(groceries.id), "sub_limit": 0}]
        )["error"]
    )


def test_delete_budget_removes_it_and_leaves_transactions_alone(budget_data, db_session):
    user, budget, *_ = budget_data
    result = budget_tools.delete_budget(user.id, str(budget.id))
    assert result["success"] is True
    assert result["deleted_budget"]["name"] == "Food"
    assert budget_tools.list_budgets(user.id) == []
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 6
    assert budget_tools.delete_budget(user.id, str(budget.id))["error"] == "Budget not found"
