"""The cross-tab, and the tool consolidation around it.

`get_amounts_by_category` replaces `get_spending_by_category` and
`get_income_by_category`, which were the same query with the sign and the
category type flipped. Merging them is tidy; `group_by` is the reason it was
worth doing. A category-by-month breakdown previously cost one call per month
or a pull of every raw row, which is the kind of thing an agent does once and
then stops offering.

The deprecated pair stay registered for one release and delegate, so nothing
that works today breaks on the way through.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import analytics as an_tools
from app.models import Account, Category, Transaction, User


USER_ID = "groupby-user"


@pytest.fixture
def three_months(db_session):
    """Groceries in three consecutive months, plus income, plus an
    uncategorized row."""
    user = User(id=USER_ID, email="gb@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    account = Account(user_id=user.id, name="Main", account_type="checking", currency="EUR")
    db_session.add(account)
    db_session.flush()

    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    dining = Category(user_id=user.id, name="Dining", category_type="expense")
    salary = Category(user_id=user.id, name="Salary", category_type="income")
    db_session.add_all([groceries, dining, salary])
    db_session.flush()

    def spend(day: datetime, amount: str, category, kind="debit"):
        return Transaction(
            user_id=user.id,
            account_id=account.id,
            amount=Decimal(amount),
            currency="EUR",
            functional_amount=Decimal(amount),
            transaction_type=kind,
            description="row",
            merchant="Shop",
            booked_at=day,
            category_id=category.id if category else None,
            include_in_analytics=True,
        )

    db_session.add_all(
        [
            spend(datetime(2026, 7, 5), "-100.00", groceries),
            spend(datetime(2026, 8, 5), "-200.00", groceries),
            spend(datetime(2026, 9, 5), "-300.00", groceries),
            spend(datetime(2026, 8, 6), "-50.00", dining),
            spend(datetime(2026, 8, 25), "2000.00", salary, kind="credit"),
            spend(datetime(2026, 8, 7), "-11.00", None),
        ]
    )
    db_session.commit()
    return user


# ---------------------------------------------------------------------------
# direction
# ---------------------------------------------------------------------------


def test_expense_direction_totals_spending(three_months):
    rows = {r["category_name"]: r for r in an_tools.get_amounts_by_category(USER_ID)}

    assert rows["Groceries"]["total"] == 600.0
    assert rows["Dining"]["total"] == 50.0
    assert "Salary" not in rows


def test_income_direction_totals_income(three_months):
    rows = {
        r["category_name"]: r for r in an_tools.get_amounts_by_category(USER_ID, direction="income")
    }

    assert rows["Salary"]["total"] == 2000.0
    assert "Groceries" not in rows


def test_totals_are_positive_in_both_directions(three_months):
    """A spending figure of -600 reads as a refund to anyone skimming."""
    for direction in ("expense", "income"):
        for row in an_tools.get_amounts_by_category(USER_ID, direction=direction):
            assert row["total"] >= 0


def test_an_unknown_direction_names_the_two_that_work(three_months):
    with pytest.raises(ToolError) as excinfo:
        an_tools.get_amounts_by_category(USER_ID, direction="outgoing")

    assert "expense" in str(excinfo.value)
    assert "income" in str(excinfo.value)


def test_uncategorized_is_opt_in_and_expenses_only(three_months):
    without = {r["category_name"] for r in an_tools.get_amounts_by_category(USER_ID)}
    assert "Uncategorized" not in without

    with_bucket = {
        r["category_name"]: r
        for r in an_tools.get_amounts_by_category(USER_ID, include_uncategorized=True)
    }
    assert with_bucket["Uncategorized"]["total"] == 11.0
    assert with_bucket["Uncategorized"]["category_id"] is None


# ---------------------------------------------------------------------------
# group_by
# ---------------------------------------------------------------------------


def test_group_by_month_splits_one_category_across_periods(three_months):
    rows = [
        r
        for r in an_tools.get_amounts_by_category(USER_ID, group_by="month")
        if r["category_name"] == "Groceries"
    ]

    assert [(r["period"], r["total"]) for r in rows] == [
        ("2026-07-01", 100.0),
        ("2026-08-01", 200.0),
        ("2026-09-01", 300.0),
    ]


def test_group_by_rows_carry_the_period_and_ungrouped_rows_do_not(three_months):
    assert all("period" not in r for r in an_tools.get_amounts_by_category(USER_ID))
    assert all(r["period"] for r in an_tools.get_amounts_by_category(USER_ID, group_by="month"))


def test_group_by_quarter_and_year_collapse_the_same_rows(three_months):
    quarterly = [
        r
        for r in an_tools.get_amounts_by_category(USER_ID, group_by="quarter")
        if r["category_name"] == "Groceries"
    ]
    yearly = [
        r
        for r in an_tools.get_amounts_by_category(USER_ID, group_by="year")
        if r["category_name"] == "Groceries"
    ]

    # July is Q3 along with August and September, so all three land together.
    assert [(r["period"], r["total"]) for r in quarterly] == [("2026-07-01", 600.0)]
    assert [(r["period"], r["total"]) for r in yearly] == [("2026-01-01", 600.0)]


def test_grouped_totals_reconcile_with_the_ungrouped_total(three_months):
    """The cross-tab is a different slicing of one number, not a different
    number."""
    ungrouped = {r["category_name"]: r["total"] for r in an_tools.get_amounts_by_category(USER_ID)}

    grouped: dict[str, float] = {}
    for row in an_tools.get_amounts_by_category(USER_ID, group_by="month"):
        grouped[row["category_name"]] = grouped.get(row["category_name"], 0) + row["total"]

    assert grouped == ungrouped


def test_an_unknown_group_by_names_the_four_that_work(three_months):
    with pytest.raises(ToolError) as excinfo:
        an_tools.get_amounts_by_category(USER_ID, group_by="week")

    message = str(excinfo.value)
    for allowed in ("none", "month", "quarter", "year"):
        assert allowed in message


def test_group_by_is_not_interpolated_from_caller_input(three_months):
    """The trunc unit reaches SQL as a literal, so the enum check is the only
    thing standing between a caller and date_trunc. It holds."""
    with pytest.raises(ToolError):
        an_tools.get_amounts_by_category(USER_ID, group_by="month'); DROP TABLE transactions; --")


# ---------------------------------------------------------------------------
# The deprecated pair
# ---------------------------------------------------------------------------


def test_the_deprecated_spending_tool_still_answers(three_months):
    old = an_tools.get_spending_by_category(USER_ID)
    new = an_tools.get_amounts_by_category(USER_ID, direction="expense")
    assert old == new


def test_the_deprecated_income_tool_still_answers(three_months):
    old = an_tools.get_income_by_category(USER_ID)
    new = an_tools.get_amounts_by_category(USER_ID, direction="income")
    assert old == new
