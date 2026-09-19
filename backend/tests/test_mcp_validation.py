"""A malformed filter argument must refuse, not widen the result set.

`validate_uuid` and `validate_date` returned None on bad input, and every
caller then guarded the filter with `if account_uuid:`. A typo therefore
*removed* the filter and returned every row the user owns -- which an agent
reads as the answer to the question it asked. Silently returning more data
than was asked for is the worst of the available failure modes: it is wrong,
it looks right, and nothing in the response hints at it.

The regression these tests exist for is the last one in the file: a bad
filter must not produce the same rows as no filter at all.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import analytics as an_tools
from app.mcp.tools import transactions as tx_tools
from app.models import Account, Category, Transaction, User


USER_ID = "validation-user"
BAD_UUID = "not-a-uuid"


@pytest.fixture
def two_accounts(db_session):
    user = User(id=USER_ID, email="validation@test.com", functional_currency="EUR")
    db_session.add(user)
    a = Account(user_id=user.id, name="A", account_type="checking", currency="EUR")
    b = Account(user_id=user.id, name="B", account_type="checking", currency="EUR")
    db_session.add_all([a, b])
    db_session.flush()
    cat = Category(user_id=user.id, name="Groceries", category_type="expense")
    db_session.add(cat)
    db_session.flush()

    for i, acc in enumerate([a, a, b, b, b]):
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
                booked_at=datetime(2026, 4, 1 + i),
                transaction_type="debit",
                include_in_analytics=True,
            )
        )
    db_session.commit()
    try:
        yield user, a, b, cat
    finally:
        db_session.query(Transaction).filter(Transaction.user_id == user.id).delete()
        db_session.query(Category).filter(Category.user_id == user.id).delete()
        db_session.query(Account).filter(Account.user_id == user.id).delete()
        db_session.query(User).filter(User.id == user.id).delete()
        db_session.commit()


@pytest.mark.parametrize(
    "kwargs, param",
    [
        ({"account_id": BAD_UUID}, "account_id"),
        ({"category_id": BAD_UUID}, "category_id"),
        ({"from_date": "nonsense"}, "from_date"),
        ({"to_date": "nonsense"}, "to_date"),
    ],
)
def test_list_transactions_rejects_malformed_filters(two_accounts, kwargs, param):
    with pytest.raises(ToolError) as excinfo:
        tx_tools.list_transactions(user_id=USER_ID, **kwargs)
    assert param in str(excinfo.value)


@pytest.mark.parametrize(
    "kwargs, param",
    [
        ({"account_id": BAD_UUID}, "account_id"),
        ({"exclude_category_id": BAD_UUID}, "exclude_category_id"),
    ],
)
def test_search_transactions_rejects_malformed_filters(two_accounts, kwargs, param):
    with pytest.raises(ToolError) as excinfo:
        tx_tools.search_transactions(user_id=USER_ID, query="M", **kwargs)
    assert param in str(excinfo.value)


@pytest.mark.parametrize(
    "kwargs, param",
    [
        ({"account_id": BAD_UUID}, "account_id"),
        ({"exclude_category_id": BAD_UUID}, "exclude_category_id"),
    ],
)
def test_search_multi_rejects_malformed_filters(two_accounts, kwargs, param):
    with pytest.raises(ToolError) as excinfo:
        tx_tools.search_transactions_multi(user_id=USER_ID, queries=["M"], **kwargs)
    assert param in str(excinfo.value)


@pytest.mark.parametrize(
    "fn, kwargs, param",
    [
        (an_tools.get_spending_by_category, {"account_id": BAD_UUID}, "account_id"),
        (an_tools.get_spending_by_category, {"from_date": "nope"}, "from_date"),
        (an_tools.get_income_by_category, {"account_id": BAD_UUID}, "account_id"),
        (an_tools.get_monthly_cashflow, {"to_date": "nope"}, "to_date"),
        (an_tools.get_financial_summary, {"from_date": "nope"}, "from_date"),
        (an_tools.get_top_merchants, {"category_id": BAD_UUID}, "category_id"),
    ],
)
def test_analytics_rejects_malformed_filters(two_accounts, fn, kwargs, param):
    with pytest.raises(ToolError) as excinfo:
        fn(user_id=USER_ID, **kwargs)
    assert param in str(excinfo.value)


def test_error_echoes_the_value_and_shows_the_expected_form(two_accounts):
    """An agent can only self-correct if the message says what was wrong."""
    with pytest.raises(ToolError) as excinfo:
        tx_tools.list_transactions(user_id=USER_ID, account_id="acct-7")
    message = str(excinfo.value)
    assert "acct-7" in message
    assert "UUID" in message


def test_lookups_still_return_none_rather_than_raising(two_accounts):
    """For a lookup, "malformed" and "no such row" are the same answer."""
    assert tx_tools.get_transaction(USER_ID, BAD_UUID) is None


def test_a_bad_filter_never_returns_the_unfiltered_set(two_accounts):
    """The regression this whole change exists for.

    The old behaviour: bad account_id -> filter dropped -> all 5 rows, which
    is exactly what the unfiltered call returns.
    """
    unfiltered = tx_tools.list_transactions(user_id=USER_ID)
    assert len(unfiltered["transactions"]) == 5

    with pytest.raises(ToolError):
        tx_tools.list_transactions(user_id=USER_ID, account_id=BAD_UUID)


def test_a_valid_filter_still_narrows(two_accounts):
    _, a, _, _ = two_accounts
    result = tx_tools.list_transactions(user_id=USER_ID, account_id=str(a.id))
    assert len(result["transactions"]) == 2
