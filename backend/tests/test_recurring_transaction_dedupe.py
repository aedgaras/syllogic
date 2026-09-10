"""Tests for reconciling generated placeholders with real transactions.

Run with:
    cd backend && .venv/bin/pytest tests/test_recurring_transaction_dedupe.py -v
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import Account, Category, RecurringTransaction, Transaction, User
from app.services.recurring_transaction_dedupe import (
    find_placeholder,
    supersede_generated_duplicates,
)


@pytest.fixture
def user(db_session):
    user = User(id="u-dedupe", email="dedupe@example.com", functional_currency="EUR")
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def account(db_session, user):
    account = Account(
        id=uuid4(),
        user_id=user.id,
        name="Checking",
        account_type="checking",
        currency="EUR",
        is_active=True,
    )
    db_session.add(account)
    db_session.commit()
    return account


@pytest.fixture
def recurring(db_session, account):
    recurring = RecurringTransaction(
        id=uuid4(),
        user_id=account.user_id,
        account_id=account.id,
        name="Netflix",
        amount=Decimal("15.99"),
        currency="EUR",
        frequency="monthly",
        importance=2,
        is_active=True,
        auto_generate=True,
    )
    db_session.add(recurring)
    db_session.commit()
    return recurring


def _add_transaction(db_session, account, recurring, **overrides) -> Transaction:
    values = dict(
        id=uuid4(),
        user_id=account.user_id,
        account_id=account.id,
        transaction_type="debit",
        amount=Decimal("-15.99"),
        currency="EUR",
        description=recurring.name,
        booked_at=datetime(2026, 3, 1),
        recurring_transaction_id=recurring.id,
        auto_generated=False,
        include_in_analytics=True,
    )
    values.update(overrides)
    txn = Transaction(**values)
    db_session.add(txn)
    db_session.commit()
    return txn


def test_untouched_placeholder_is_deleted_when_the_real_row_arrives(db_session, account, recurring):
    placeholder = _add_transaction(db_session, account, recurring, auto_generated=True)
    real = _add_transaction(
        db_session,
        account,
        recurring,
        description="NETFLIX.COM AMSTERDAM",
        amount=Decimal("-15.99"),
        booked_at=datetime(2026, 3, 4),
        external_id="bank-1",
    )

    outcome = supersede_generated_duplicates(db_session, account.user_id)

    assert outcome["deleted"] == 1
    assert outcome["demoted"] == 0
    assert outcome["account_ids"] == [str(account.id)]
    remaining = db_session.query(Transaction).all()
    assert [t.id for t in remaining] == [real.id]
    assert db_session.get(Transaction, placeholder.id) is None


def test_edited_placeholder_is_kept_but_dropped_from_analytics(
    db_session, account, recurring, user
):
    """A user edit is never destroyed -- the row survives, the double count doesn't."""
    category = Category(id=uuid4(), user_id=user.id, name="Streaming", category_type="expense")
    db_session.add(category)
    db_session.commit()
    placeholder = _add_transaction(
        db_session,
        account,
        recurring,
        auto_generated=True,
        description="Netflix (family plan share)",
        category_id=category.id,
    )
    _add_transaction(
        db_session,
        account,
        recurring,
        description="NETFLIX.COM AMSTERDAM",
        booked_at=datetime(2026, 3, 4),
        external_id="bank-1",
    )

    outcome = supersede_generated_duplicates(db_session, account.user_id)

    assert outcome == {"deleted": 0, "demoted": 1, "account_ids": [str(account.id)]}
    db_session.refresh(placeholder)
    assert placeholder.include_in_analytics is False
    assert placeholder.description == "Netflix (family plan share)"


def test_placeholder_outside_the_match_window_is_left_alone(db_session, account, recurring):
    placeholder = _add_transaction(
        db_session, account, recurring, auto_generated=True, booked_at=datetime(2026, 3, 1)
    )
    _add_transaction(
        db_session,
        account,
        recurring,
        booked_at=datetime(2026, 3, 20),
        external_id="bank-1",
    )

    outcome = supersede_generated_duplicates(db_session, account.user_id)

    assert outcome["deleted"] == 0
    db_session.refresh(placeholder)
    assert placeholder.include_in_analytics is True


def test_placeholder_with_a_different_amount_is_left_alone(db_session, account, recurring):
    _add_transaction(db_session, account, recurring, auto_generated=True)
    _add_transaction(
        db_session,
        account,
        recurring,
        amount=Decimal("-99.00"),
        booked_at=datetime(2026, 3, 2),
        external_id="bank-1",
    )

    outcome = supersede_generated_duplicates(db_session, account.user_id)

    assert outcome["deleted"] == 0
    assert outcome["demoted"] == 0


def test_variable_amount_definition_matches_regardless_of_amount(db_session, account, recurring):
    recurring.is_variable_amount = True
    db_session.commit()
    _add_transaction(db_session, account, recurring, auto_generated=True)
    _add_transaction(
        db_session,
        account,
        recurring,
        amount=Decimal("-42.10"),
        booked_at=datetime(2026, 3, 2),
        external_id="bank-1",
    )

    outcome = supersede_generated_duplicates(db_session, account.user_id)

    assert outcome["deleted"] == 1


def test_sweep_scoped_to_transaction_ids_ignores_everything_else(db_session, account, recurring):
    _add_transaction(db_session, account, recurring, auto_generated=True)
    _add_transaction(
        db_session, account, recurring, booked_at=datetime(2026, 3, 2), external_id="bank-1"
    )

    outcome = supersede_generated_duplicates(
        db_session, account.user_id, transaction_ids=[str(uuid4())]
    )

    assert outcome["deleted"] == 0


def test_find_placeholder_only_returns_generated_rows(db_session, account, recurring):
    real = _add_transaction(db_session, account, recurring, external_id="bank-1")

    found = find_placeholder(
        db_session,
        user_id=account.user_id,
        account_id=account.id,
        recurring_id=recurring.id,
        booked_at=real.booked_at,
        amount=real.amount,
    )

    assert found is None
