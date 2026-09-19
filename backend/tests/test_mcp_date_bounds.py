"""`to_date` includes the whole of the day it names.

`validate_date` parsed a bare YYYY-MM-DD with `datetime.fromisoformat`, which
yields midnight, and every caller then filtered `booked_at <= to_dt`. A
transaction booked at any time during the closing day was therefore dropped,
so "this month" quietly meant "this month minus its last day" -- in every
tool that takes a date range, with nothing in the response to show for it.

These tests put a transaction at one second to midnight on the closing day
and require it to be counted.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import accounts as acct_tools
from app.mcp.tools import analytics as an_tools
from app.mcp.tools import transactions as tx_tools
from app.models import Account, AccountBalance, Category, Transaction, User


USER_ID = "bounds-user"
LAST_DAY = "2026-04-30"


@pytest.fixture
def boundary_data(db_session):
    user = User(id=USER_ID, email="bounds@test.com", functional_currency="EUR")
    db_session.add(user)
    acc = Account(user_id=user.id, name="Acct", account_type="checking", currency="EUR")
    db_session.add(acc)
    db_session.flush()
    cat = Category(user_id=user.id, name="Groceries", category_type="expense")
    db_session.add(cat)
    db_session.flush()

    moments = [
        # Comfortably inside the range.
        datetime(2026, 4, 15, 12, 0, 0),
        # The row the old `<=` midnight bound dropped.
        datetime(2026, 4, 30, 23, 59, 59),
        # Genuinely outside: the first instant of the next day.
        datetime(2026, 5, 1, 0, 0, 0),
    ]
    for i, moment in enumerate(moments):
        db_session.add(
            Transaction(
                user_id=user.id,
                account_id=acc.id,
                amount=Decimal("-10.00"),
                functional_amount=Decimal("-10.00"),
                currency="EUR",
                description=f"txn {i}",
                merchant=f"M{i}",
                category_id=cat.id,
                booked_at=moment,
                transaction_type="debit",
                include_in_analytics=True,
            )
        )

    for i, moment in enumerate(moments):
        db_session.add(
            AccountBalance(
                account_id=acc.id,
                date=moment,
                balance_in_account_currency=Decimal("100.00"),
                balance_in_functional_currency=Decimal("100.00"),
            )
        )
    db_session.commit()

    try:
        yield user, acc, cat
    finally:
        db_session.query(AccountBalance).filter(AccountBalance.account_id == acc.id).delete()
        db_session.query(Transaction).filter(Transaction.user_id == user.id).delete()
        db_session.query(Category).filter(Category.user_id == user.id).delete()
        db_session.query(Account).filter(Account.user_id == user.id).delete()
        db_session.query(User).filter(User.id == user.id).delete()
        db_session.commit()


def test_list_transactions_includes_the_closing_day(boundary_data):
    result = tx_tools.list_transactions(user_id=USER_ID, from_date="2026-04-01", to_date=LAST_DAY)
    assert len(result["transactions"]) == 2


def test_list_transactions_still_excludes_the_next_day(boundary_data):
    result = tx_tools.list_transactions(user_id=USER_ID, from_date="2026-04-01", to_date=LAST_DAY)
    dates = {t["booked_at"][:10] for t in result["transactions"]}
    assert "2026-05-01" not in dates


def test_spending_by_category_includes_the_closing_day(boundary_data):
    rows = an_tools.get_spending_by_category(
        user_id=USER_ID, from_date="2026-04-01", to_date=LAST_DAY
    )
    assert rows[0]["total"] == pytest.approx(20.0)


def test_financial_summary_includes_the_closing_day(boundary_data):
    summary = an_tools.get_financial_summary(
        user_id=USER_ID, from_date="2026-04-01", to_date=LAST_DAY
    )
    assert summary["total_expenses"] == pytest.approx(20.0)


def test_top_merchants_includes_the_closing_day(boundary_data):
    merchants = an_tools.get_top_merchants(
        user_id=USER_ID, from_date="2026-04-01", to_date=LAST_DAY
    )
    assert {m["merchant"] for m in merchants} == {"M0", "M1"}


def test_balance_history_includes_the_closing_day(boundary_data):
    _, acc, _ = boundary_data
    history = acct_tools.get_account_balance_history(USER_ID, str(acc.id), "2026-04-01", LAST_DAY)
    assert len(history) == 2


def test_an_explicit_timestamp_is_honoured_exactly(boundary_data):
    """A caller precise enough to name a time meant it -- no day rounding."""
    result = tx_tools.list_transactions(
        user_id=USER_ID, from_date="2026-04-01", to_date="2026-04-30T12:00:00"
    )
    assert len(result["transactions"]) == 1


@pytest.mark.parametrize(
    "spelling",
    [
        "2026-04-30",  # extended ISO
        "20260430",  # basic ISO -- a length check mistook this for a timestamp
        " 2026-04-30 ",  # padded
    ],
)
def test_every_date_only_spelling_covers_the_whole_day(boundary_data, spelling):
    result = tx_tools.list_transactions(user_id=USER_ID, from_date="2026-04-01", to_date=spelling)
    assert len(result["transactions"]) == 2


@pytest.mark.parametrize("bad", ["30-04-2026", "April 30", "2026-13-01", ""])
def test_malformed_dates_raise_rather_than_widening(boundary_data, bad):
    with pytest.raises(ToolError) as excinfo:
        tx_tools.list_transactions(user_id=USER_ID, to_date=bad)
    assert "to_date" in str(excinfo.value)
