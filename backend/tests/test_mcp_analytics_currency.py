"""Analytics aggregates must be stated in one currency, and say which.

Before this, every aggregate summed the raw `t.amount` column and returned a
bare float. For a user holding accounts in more than one currency that number
was the arithmetic sum of two different units, with nothing in the response to
say so -- a wrong answer that is indistinguishable from a right one.

The rule these tests pin down:

- totals are in the user's functional currency, and carry it
- a row that cannot be stated in that currency is *excluded*, not coerced
- the number of excluded rows is reported, so an undercount is visible
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from app.mcp.tools import analytics as an_tools
from app.models import (
    Account,
    Category,
    ExchangeRate,
    Transaction,
    User,
)


USER_ID = "fx-user"


@pytest.fixture
def fx_data(db_session):
    """One EUR account and one USD account, for a user reporting in EUR.

    The USD account holds two otherwise-identical transactions: one that was
    converted at import time, one that was not because no rate was on record.
    The second is the interesting row -- it is what COALESCE(functional_amount,
    amount) would have silently added to a euro total as if it were euros.
    """
    user = User(id=USER_ID, email="fx@test.com", functional_currency="EUR")
    db_session.add(user)

    eur_acc = Account(user_id=user.id, name="EUR acct", account_type="checking", currency="EUR")
    usd_acc = Account(user_id=user.id, name="USD acct", account_type="checking", currency="USD")
    db_session.add_all([eur_acc, usd_acc])
    db_session.flush()

    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    salary = Category(user_id=user.id, name="Salary", category_type="income")
    db_session.add_all([groceries, salary])
    db_session.flush()

    db_session.add(
        ExchangeRate(
            date=datetime(2026, 4, 1),
            base_currency="USD",
            target_currency="EUR",
            rate=Decimal("0.90"),
        )
    )

    rows = [
        # EUR expense: 100 EUR, already in the functional currency.
        dict(
            account_id=eur_acc.id,
            amount="-100.00",
            currency="EUR",
            functional_amount="-100.00",
            category_id=groceries.id,
            transaction_type="debit",
            merchant="EuroMart",
        ),
        # USD expense: 200 USD converted to 180 EUR at import.
        dict(
            account_id=usd_acc.id,
            amount="-200.00",
            currency="USD",
            functional_amount="-180.00",
            category_id=groceries.id,
            transaction_type="debit",
            merchant="DollarMart",
        ),
        # USD expense with no rate at import: cannot be counted.
        dict(
            account_id=usd_acc.id,
            amount="-500.00",
            currency="USD",
            functional_amount=None,
            category_id=groceries.id,
            transaction_type="debit",
            merchant="UnknownMart",
        ),
        # Income, so the income paths get the same treatment.
        dict(
            account_id=eur_acc.id,
            amount="1000.00",
            currency="EUR",
            functional_amount="1000.00",
            category_id=salary.id,
            transaction_type="credit",
            merchant="Employer",
        ),
    ]
    for i, row in enumerate(rows):
        fa = row.pop("functional_amount")
        db_session.add(
            Transaction(
                user_id=user.id,
                description=f"fx txn {i}",
                booked_at=datetime(2026, 4, 10 + i),
                include_in_analytics=True,
                amount=Decimal(row.pop("amount")),
                functional_amount=Decimal(fa) if fa is not None else None,
                **row,
            )
        )
    db_session.commit()

    try:
        yield user, eur_acc, usd_acc, groceries, salary
    finally:
        db_session.query(Transaction).filter(Transaction.user_id == user.id).delete()
        db_session.query(Category).filter(Category.user_id == user.id).delete()
        db_session.query(Account).filter(Account.user_id == user.id).delete()
        db_session.query(ExchangeRate).delete()
        db_session.query(User).filter(User.id == user.id).delete()
        db_session.commit()


def test_spending_is_summed_in_functional_currency(fx_data):
    rows = an_tools.get_spending_by_category(user_id=USER_ID)
    assert len(rows) == 1
    row = rows[0]

    # 100 EUR + 180 EUR. NOT 300 (raw amounts) and NOT 780 (raw + coalesce).
    assert row["total"] == pytest.approx(280.0)
    assert row["currency"] == "EUR"


def test_unconverted_rows_are_reported_not_hidden(fx_data):
    row = an_tools.get_spending_by_category(user_id=USER_ID)[0]
    assert row["unconverted_transaction_count"] == 1


def test_income_carries_currency(fx_data):
    rows = an_tools.get_income_by_category(user_id=USER_ID)
    assert len(rows) == 1
    assert rows[0]["total"] == pytest.approx(1000.0)
    assert rows[0]["currency"] == "EUR"
    assert rows[0]["unconverted_transaction_count"] == 0


def test_monthly_cashflow_carries_currency(fx_data):
    months = an_tools.get_monthly_cashflow(user_id=USER_ID)
    assert len(months) == 1
    month = months[0]
    assert month["expenses"] == pytest.approx(280.0)
    assert month["income"] == pytest.approx(1000.0)
    assert month["currency"] == "EUR"
    assert month["unconverted_transaction_count"] == 1


def test_financial_summary_carries_currency(fx_data):
    summary = an_tools.get_financial_summary(user_id=USER_ID)
    assert summary["total_expenses"] == pytest.approx(280.0)
    assert summary["total_income"] == pytest.approx(1000.0)
    assert summary["currency"] == "EUR"
    assert summary["unconverted_transaction_count"] == 1


def test_top_merchants_excludes_the_unconvertible_row(fx_data):
    merchants = {m["merchant"]: m for m in an_tools.get_top_merchants(user_id=USER_ID)}

    assert merchants["EuroMart"]["total"] == pytest.approx(100.0)
    assert merchants["DollarMart"]["total"] == pytest.approx(180.0)
    assert all(m["currency"] == "EUR" for m in merchants.values())

    # Present, but contributing 0 and flagged -- rather than contributing 500
    # dollars to a euro ranking, which would have put it top.
    assert merchants["UnknownMart"]["total"] == pytest.approx(0.0)
    assert merchants["UnknownMart"]["unconverted_transaction_count"] == 1


def test_account_balances_are_not_mixed_into_the_total(db_session, fx_data):
    """A foreign account with no functional_balance is excluded from the total.

    The old expression was `functional_balance or balance_available`, which
    fell back to the account's native balance -- adding dollars to a euro
    net worth.
    """
    _, eur_acc, usd_acc, _, _ = fx_data
    eur_acc.balance_available = Decimal("1000.00")
    eur_acc.functional_balance = Decimal("1000.00")
    usd_acc.balance_available = Decimal("5000.00")
    usd_acc.functional_balance = None
    db_session.commit()

    summary = an_tools.get_financial_summary(user_id=USER_ID)

    assert summary["total_balance"] == pytest.approx(1000.0)
    assert summary["unconverted_account_count"] == 1

    by_name = {a["name"]: a for a in summary["accounts"]}
    assert by_name["USD acct"]["balance"] is None
    assert by_name["USD acct"]["account_currency"] == "USD"
    assert by_name["USD acct"]["native_balance"] == pytest.approx(5000.0)
    assert by_name["EUR acct"]["currency"] == "EUR"


def test_zero_functional_balance_is_not_treated_as_missing(db_session, fx_data):
    """`functional_balance or balance_available` also broke on a real zero."""
    _, eur_acc, usd_acc, _, _ = fx_data
    eur_acc.balance_available = Decimal("250.00")
    eur_acc.functional_balance = Decimal("0.00")
    usd_acc.functional_balance = Decimal("0.00")
    usd_acc.balance_available = Decimal("9999.00")
    db_session.commit()

    summary = an_tools.get_financial_summary(user_id=USER_ID)

    assert summary["total_balance"] == pytest.approx(0.0)
    assert summary["unconverted_account_count"] == 0
