"""Tests for materializing transactions from recurring definitions.

Run with:
    cd backend && .venv/bin/pytest tests/test_recurring_transaction_generator.py -v
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import Account, Category, RecurringTransaction, Transaction, User
from app.services import recurring_transaction_generator as generator
from app.services.recurring_transaction_generator import generate_due_transactions


@pytest.fixture(autouse=True)
def _skip_balance_backfill(monkeypatch):
    """Balance/FX recomputation is exercised by its own service tests; these
    tests care about which rows get written and how the schedule moves."""
    monkeypatch.setattr(
        generator, "_backfill_functional_amounts_and_balances", lambda *a, **k: None
    )


@pytest.fixture
def user(db_session):
    user = User(id="u-recurring", email="recurring@example.com", functional_currency="EUR")
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


def _make_recurring(db_session, account, **overrides) -> RecurringTransaction:
    values = dict(
        id=uuid4(),
        user_id=account.user_id,
        account_id=account.id,
        name="Rent",
        amount=Decimal("500.00"),
        currency="EUR",
        frequency="monthly",
        importance=3,
        is_active=True,
        auto_generate=True,
        next_due_date=date(2026, 1, 1),
    )
    values.update(overrides)
    recurring = RecurringTransaction(**values)
    db_session.add(recurring)
    db_session.commit()
    return recurring


def _transactions(db_session, recurring) -> list[Transaction]:
    return (
        db_session.query(Transaction)
        .filter(Transaction.recurring_transaction_id == recurring.id)
        .order_by(Transaction.booked_at)
        .all()
    )


def test_generates_one_transaction_when_a_single_occurrence_is_due(db_session, account):
    recurring = _make_recurring(db_session, account)

    result = generate_due_transactions(db_session, today=date(2026, 1, 3))

    assert len(result.created) == 1
    txn = _transactions(db_session, recurring)[0]
    assert txn.amount == Decimal("-500.00")
    assert txn.transaction_type == "debit"
    assert txn.description == "Rent"
    assert txn.auto_generated is True
    assert txn.booked_at.date() == date(2026, 1, 1)
    assert recurring.next_due_date == date(2026, 2, 1)


def test_catches_up_every_missed_occurrence_on_its_own_date(db_session, account):
    """A definition three periods behind produces three rows, not one."""
    recurring = _make_recurring(db_session, account, next_due_date=date(2026, 1, 15))

    result = generate_due_transactions(db_session, today=date(2026, 4, 20))

    booked = [t.booked_at.date() for t in _transactions(db_session, recurring)]
    assert booked == [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)]
    assert len(result.created) == 4
    assert recurring.next_due_date == date(2026, 5, 15)


def test_catch_up_stops_at_the_occurrence_cap(db_session, account):
    recurring = _make_recurring(
        db_session, account, frequency="weekly", next_due_date=date(2020, 1, 1)
    )

    result = generate_due_transactions(db_session, today=date(2026, 1, 1))

    assert len(result.created) == generator.MAX_CATCHUP_OCCURRENCES
    # Schedule advanced by exactly the number of rows written, so the next run
    # picks up where this one stopped.
    assert recurring.next_due_date == date(2020, 1, 1) + timedelta(
        weeks=generator.MAX_CATCHUP_OCCURRENCES
    )


def test_income_category_generates_a_positive_credit(db_session, account, user):
    category = Category(id=uuid4(), user_id=user.id, name="Salary", category_type="income")
    db_session.add(category)
    db_session.commit()
    recurring = _make_recurring(
        db_session, account, name="Salary", amount=Decimal("3000"), category_id=category.id
    )

    generate_due_transactions(db_session, today=date(2026, 1, 2))

    txn = _transactions(db_session, recurring)[0]
    assert txn.amount == Decimal("3000.00")
    assert txn.transaction_type == "credit"


def test_end_date_stops_generation_and_turns_auto_generate_off(db_session, account):
    recurring = _make_recurring(db_session, account, end_date=date(2026, 2, 1))

    generate_due_transactions(db_session, today=date(2026, 6, 1))

    booked = [t.booked_at.date() for t in _transactions(db_session, recurring)]
    assert booked == [date(2026, 1, 1), date(2026, 2, 1)]
    assert recurring.auto_generate is False


def test_skips_an_occurrence_a_real_transaction_already_covers(db_session, account):
    """The bank row arrived first; the placeholder must not double count it."""
    recurring = _make_recurring(db_session, account)
    db_session.add(
        Transaction(
            id=uuid4(),
            user_id=account.user_id,
            account_id=account.id,
            transaction_type="debit",
            amount=Decimal("-502.00"),
            currency="EUR",
            description="RENT PAYMENT",
            booked_at=datetime(2026, 1, 3),
            recurring_transaction_id=recurring.id,
            auto_generated=False,
        )
    )
    db_session.commit()

    result = generate_due_transactions(db_session, today=date(2026, 1, 5))

    assert result.created == []
    assert result.skipped_existing == 1
    assert recurring.next_due_date == date(2026, 2, 1)


def test_a_real_transaction_far_from_the_due_date_does_not_suppress_generation(db_session, account):
    recurring = _make_recurring(db_session, account)
    db_session.add(
        Transaction(
            id=uuid4(),
            user_id=account.user_id,
            account_id=account.id,
            transaction_type="debit",
            amount=Decimal("-500.00"),
            currency="EUR",
            description="RENT PAYMENT",
            booked_at=datetime(2025, 12, 1),
            recurring_transaction_id=recurring.id,
            auto_generated=False,
        )
    )
    db_session.commit()

    result = generate_due_transactions(db_session, today=date(2026, 1, 5))

    assert len(result.created) == 1


def test_running_twice_for_the_same_period_creates_nothing_new(db_session, account):
    recurring = _make_recurring(db_session, account)

    generate_due_transactions(db_session, today=date(2026, 1, 3))
    generate_due_transactions(db_session, today=date(2026, 1, 3))

    assert len(_transactions(db_session, recurring)) == 1


def test_single_occurrence_generates_ahead_of_the_due_date(db_session, account):
    """ "Generate now" books the next occurrence before it comes due."""
    recurring = _make_recurring(db_session, account, next_due_date=date(2026, 3, 1))

    result = generate_due_transactions(
        db_session,
        recurring_ids=[recurring.id],
        today=date(2026, 1, 10),
        single_occurrence=True,
    )

    assert len(result.created) == 1
    assert result.created[0].booked_at.date() == date(2026, 3, 1)
    assert recurring.next_due_date == date(2026, 4, 1)


def test_inactive_and_manual_definitions_are_left_alone(db_session, account):
    paused = _make_recurring(db_session, account, name="Paused", is_active=False)
    manual = _make_recurring(db_session, account, name="Manual", auto_generate=False)

    generate_due_transactions(db_session, today=date(2026, 6, 1))

    assert _transactions(db_session, paused) == []
    assert _transactions(db_session, manual) == []
