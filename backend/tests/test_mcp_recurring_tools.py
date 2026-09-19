"""Tests for the recurring transaction MCP write tools.

The dry-run / idempotency contract these share with every other write tool
is covered once, for all of them, in test_mcp_write_safety.py. What is here
is what is specific to recurring transactions:

* the schedule rules, which are the web app's rules and have to stay its
  rules (frontend/lib/actions/subscriptions.ts),
* the guards on generate/skip, which exist so "created 0 transactions"
  never has to stand in for "this definition never books anything",
* and the fact that generating goes through the same generator the daily
  beat uses rather than a second implementation of it.

These need the scratch Postgres described in tests/README.md.

Run with:
    cd backend && .venv/bin/pytest tests/test_mcp_recurring_tools.py -v
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import recurring as recurring_tools
from app.models import Account, Category, RecurringTransaction, Transaction, User


USER_ID = "recurring-tools-user"
OTHER_USER_ID = "recurring-tools-stranger"


@pytest.fixture
def seeded(db_session):
    user = User(id=USER_ID, email="rt@test.com", functional_currency="EUR")
    stranger = User(id=OTHER_USER_ID, email="stranger@test.com", functional_currency="EUR")
    db_session.add_all([user, stranger])
    db_session.flush()

    account = Account(user_id=USER_ID, name="Main", account_type="checking", currency="EUR")
    other_account = Account(user_id=USER_ID, name="Savings", account_type="savings", currency="EUR")
    stranger_account = Account(
        user_id=OTHER_USER_ID, name="Theirs", account_type="checking", currency="EUR"
    )
    entertainment = Category(user_id=USER_ID, name="Entertainment", category_type="expense")
    salary = Category(user_id=USER_ID, name="Salary", category_type="income")
    db_session.add_all([account, other_account, stranger_account, entertainment, salary])
    db_session.flush()

    scheduled = RecurringTransaction(
        user_id=USER_ID,
        account_id=account.id,
        name="Streaming",
        amount=Decimal("15.00"),
        currency="EUR",
        frequency="monthly",
        importance=3,
        is_active=True,
        category_id=entertainment.id,
        next_due_date=date(2026, 9, 1),
        auto_generate=True,
    )
    # What subscription_detector.py produces: a label with no schedule.
    label_only = RecurringTransaction(
        user_id=USER_ID,
        account_id=account.id,
        name="Gym",
        amount=Decimal("30.00"),
        currency="EUR",
        frequency="monthly",
        importance=2,
        is_active=True,
    )
    db_session.add_all([scheduled, label_only])
    db_session.commit()

    return {
        "account": account,
        "other_account": other_account,
        "stranger_account": stranger_account,
        "entertainment": entertainment,
        "salary": salary,
        "scheduled": scheduled,
        "label_only": label_only,
    }


# ---------------------------------------------------------------------------
# Reads carry the schedule
# ---------------------------------------------------------------------------


def test_reads_say_whether_a_definition_books_anything(seeded):
    """Without these fields an agent cannot tell a label from a schedule,
    and every answer about auto-generation is a guess."""
    rows = {r["name"]: r for r in recurring_tools.list_recurring_transactions(USER_ID)}

    assert rows["Streaming"]["auto_generate"] is True
    assert rows["Streaming"]["next_due_date"] == "2026-09-01"
    assert rows["Gym"]["auto_generate"] is False
    assert rows["Gym"]["next_due_date"] is None
    assert rows["Gym"]["is_variable_amount"] is False


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


def test_create_stores_the_whole_definition(seeded):
    result = recurring_tools.create_recurring_transaction(
        USER_ID,
        "Cloud Backup",
        7.5,
        str(seeded["account"].id),
        "yearly",
        merchant="Backblaze",
        category_id=str(seeded["entertainment"].id),
        importance=2,
        description="offsite",
        next_due_date="2026-10-01",
        end_date="2028-10-01",
        auto_generate=True,
    )

    created = result["recurring_transaction"]
    assert result["committed"] is True
    assert created["amount"] == 7.5
    assert created["frequency"] == "yearly"
    assert created["merchant"] == "Backblaze"
    assert created["category_name"] == "Entertainment"
    assert created["next_due_date"] == "2026-10-01"
    assert created["end_date"] == "2028-10-01"
    assert created["auto_generate"] is True


def test_create_defaults_to_a_label_with_no_schedule(seeded):
    result = recurring_tools.create_recurring_transaction(
        USER_ID, "Newspaper", 5.0, str(seeded["account"].id), "monthly"
    )

    created = result["recurring_transaction"]
    assert created["auto_generate"] is False
    assert created["next_due_date"] is None


@pytest.mark.parametrize(
    "kwargs,message",
    [
        ({"name": "  "}, "Missing name"),
        ({"amount": 0}, "amount"),
        ({"amount": -5.0}, "amount"),
        ({"frequency": "fortnightly"}, "Invalid frequency"),
        ({"importance": 5}, "importance"),
        ({"next_due_date": "01/10/2026"}, "next_due_date"),
    ],
)
def test_create_rejects_bad_input(seeded, kwargs, message):
    call = {
        "name": "Valid",
        "amount": 10.0,
        "account_id": str(seeded["account"].id),
        "frequency": "monthly",
    }
    call.update(kwargs)

    with pytest.raises(ToolError, match=message):
        recurring_tools.create_recurring_transaction(USER_ID, **call)


def test_auto_generate_without_a_due_date_is_refused(seeded):
    """The beat has nothing to fire on, so the row would silently never
    generate -- the failure the web app's form also refuses to create."""
    with pytest.raises(ToolError, match="next_due_date"):
        recurring_tools.create_recurring_transaction(
            USER_ID,
            "Broken",
            10.0,
            str(seeded["account"].id),
            "monthly",
            auto_generate=True,
        )


def test_an_end_date_before_the_first_due_date_is_refused(seeded):
    with pytest.raises(ToolError, match="end_date"):
        recurring_tools.create_recurring_transaction(
            USER_ID,
            "Backwards",
            10.0,
            str(seeded["account"].id),
            "monthly",
            next_due_date="2026-10-01",
            end_date="2026-09-01",
        )


def test_create_rejects_an_account_the_user_does_not_own(seeded):
    with pytest.raises(ToolError, match="No account found"):
        recurring_tools.create_recurring_transaction(
            USER_ID, "Sneaky", 10.0, str(seeded["stranger_account"].id), "monthly"
        )


def test_create_rejects_a_duplicate_name_on_the_same_account(seeded):
    with pytest.raises(ToolError, match="already used"):
        recurring_tools.create_recurring_transaction(
            USER_ID, "Streaming", 15.0, str(seeded["account"].id), "monthly"
        )


def test_the_same_name_on_another_account_is_fine(seeded):
    result = recurring_tools.create_recurring_transaction(
        USER_ID, "Streaming", 15.0, str(seeded["other_account"].id), "monthly"
    )
    assert result["committed"] is True


# ---------------------------------------------------------------------------
# update
# ---------------------------------------------------------------------------


def test_update_only_touches_what_it_is_given(seeded):
    result = recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), amount=17.5
    )

    assert result["fields_changed"] == ["amount"]
    assert result["before"]["amount"] == 15.0
    assert result["after"]["amount"] == 17.5
    assert result["recurring_transaction"]["frequency"] == "monthly"
    assert result["recurring_transaction"]["next_due_date"] == "2026-09-01"


def test_update_to_the_same_value_reports_no_change(seeded):
    result = recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), amount=15.0
    )

    assert result["changed"] is False
    assert result["fields_changed"] == []


def test_an_empty_string_clears_the_schedule(seeded):
    recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), auto_generate=False
    )
    result = recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), next_due_date=""
    )

    assert result["recurring_transaction"]["next_due_date"] is None


def test_clearing_the_due_date_while_auto_generate_stays_on_is_refused(seeded):
    with pytest.raises(ToolError, match="next_due_date"):
        recurring_tools.update_recurring_transaction(
            USER_ID, str(seeded["scheduled"].id), next_due_date=""
        )


def test_turning_auto_generate_on_needs_a_due_date_already_on_file(seeded):
    """The rule is checked against the merged row, not the arguments: this
    call never mentions next_due_date and is still wrong."""
    with pytest.raises(ToolError, match="next_due_date"):
        recurring_tools.update_recurring_transaction(
            USER_ID, str(seeded["label_only"].id), auto_generate=True
        )


def test_turning_auto_generate_on_with_a_due_date_works(seeded):
    result = recurring_tools.update_recurring_transaction(
        USER_ID,
        str(seeded["label_only"].id),
        auto_generate=True,
        next_due_date="2026-10-15",
    )

    assert result["recurring_transaction"]["auto_generate"] is True
    assert result["recurring_transaction"]["next_due_date"] == "2026-10-15"


def test_update_requires_at_least_one_field(seeded):
    with pytest.raises(ToolError, match="fields to update"):
        recurring_tools.update_recurring_transaction(USER_ID, str(seeded["scheduled"].id))


def test_update_is_scoped_to_the_caller(seeded):
    with pytest.raises(ToolError, match="No recurring transaction found"):
        recurring_tools.update_recurring_transaction(
            OTHER_USER_ID, str(seeded["scheduled"].id), amount=1.0
        )


def test_an_unknown_id_names_what_does_exist(seeded):
    with pytest.raises(ToolError, match="Streaming"):
        recurring_tools.update_recurring_transaction(
            USER_ID, "00000000-0000-0000-0000-000000000000", amount=1.0
        )


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


def test_delete_keeps_the_transactions_and_says_how_many(seeded, db_session):
    txn = Transaction(
        user_id=USER_ID,
        account_id=seeded["account"].id,
        amount=Decimal("-15.00"),
        currency="EUR",
        transaction_type="debit",
        description="Streaming",
        booked_at=datetime(2026, 8, 1),
        recurring_transaction_id=seeded["scheduled"].id,
        auto_generated=True,
    )
    db_session.add(txn)
    db_session.commit()

    result = recurring_tools.delete_recurring_transaction(USER_ID, str(seeded["scheduled"].id))

    doomed = result["deleted_recurring_transaction"]
    assert doomed["unlinked_transaction_count"] == 1
    assert doomed["orphaned_generated_transaction_count"] == 1

    db_session.expire_all()
    assert db_session.query(RecurringTransaction).filter_by(name="Streaming").count() == 0
    survivor = db_session.query(Transaction).filter_by(id=txn.id).one()
    assert survivor.recurring_transaction_id is None


def test_delete_dry_run_counts_without_deleting(seeded, db_session):
    result = recurring_tools.delete_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), dry_run=True
    )

    assert result["committed"] is False
    db_session.expire_all()
    assert db_session.query(RecurringTransaction).filter_by(name="Streaming").count() == 1


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------


def test_generate_books_the_occurrence_and_advances_the_schedule(seeded, db_session):
    result = recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))

    assert result["created_count"] == 1
    assert result["next_due_date"] == "2026-10-01"

    db_session.expire_all()
    booked = (
        db_session.query(Transaction)
        .filter_by(recurring_transaction_id=seeded["scheduled"].id)
        .one()
    )
    # Expense category, so the charge is a debit; the generator owns that
    # decision and this tool does not second-guess it.
    assert booked.amount == Decimal("-15.00")
    assert booked.auto_generated is True
    assert booked.booked_at.date() == date(2026, 9, 1)


def test_generating_twice_does_not_double_book(seeded):
    """The second call lands on the next occurrence, not the same one."""
    first = recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))
    second = recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))

    assert first["next_due_date"] == "2026-10-01"
    assert second["next_due_date"] == "2026-11-01"


def test_generate_refuses_a_label_only_definition(seeded):
    """Left to the generator this returns 'created 0', which reads as
    'already covered' rather than 'this never books anything'."""
    with pytest.raises(ToolError, match="no schedule"):
        recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["label_only"].id))


def test_generate_refuses_when_auto_generate_is_off(seeded):
    recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), auto_generate=False
    )

    with pytest.raises(ToolError, match="auto_generate"):
        recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))


def test_generate_refuses_an_inactive_definition(seeded):
    recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), is_active=False
    )

    with pytest.raises(ToolError, match="active"):
        recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))


def test_generate_refuses_a_schedule_that_has_ended(seeded, db_session):
    """Set directly, because the update tool refuses to produce this state.
    The row can still reach it from elsewhere -- the web app's editor, or an
    end date added after the schedule had already run past it."""
    seeded["scheduled"].end_date = date(2026, 8, 1)
    db_session.commit()

    with pytest.raises(ToolError, match="end_date|next_due_date"):
        recurring_tools.generate_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))


def test_generate_dry_run_books_nothing(seeded, db_session):
    result = recurring_tools.generate_recurring_occurrence(
        USER_ID, str(seeded["scheduled"].id), dry_run=True
    )

    assert result["created_count"] == 1
    assert result["committed"] is False

    db_session.expire_all()
    assert db_session.query(Transaction).count() == 0
    assert db_session.query(RecurringTransaction).filter_by(
        id=seeded["scheduled"].id
    ).one().next_due_date == date(2026, 9, 1)


def test_an_idempotency_key_stops_a_retry_booking_twice(seeded, db_session):
    first = recurring_tools.generate_recurring_occurrence(
        USER_ID, str(seeded["scheduled"].id), idempotency_key="gen-1"
    )
    second = recurring_tools.generate_recurring_occurrence(
        USER_ID, str(seeded["scheduled"].id), idempotency_key="gen-1"
    )

    assert second["idempotent_replay"] is True
    assert second["next_due_date"] == first["next_due_date"]

    db_session.expire_all()
    assert db_session.query(Transaction).count() == 1


# ---------------------------------------------------------------------------
# skip
# ---------------------------------------------------------------------------


def test_skip_advances_without_booking(seeded, db_session):
    result = recurring_tools.skip_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))

    assert result["skipped_date"] == "2026-09-01"
    assert result["next_due_date"] == "2026-10-01"

    db_session.expire_all()
    assert db_session.query(Transaction).count() == 0


def test_skipping_past_the_end_date_stops_the_schedule(seeded):
    recurring_tools.update_recurring_transaction(
        USER_ID, str(seeded["scheduled"].id), end_date="2026-09-15"
    )

    result = recurring_tools.skip_recurring_occurrence(USER_ID, str(seeded["scheduled"].id))

    assert result["next_due_date"] == "2026-10-01"
    assert result["auto_generate"] is False


def test_skip_refuses_a_definition_with_no_schedule(seeded):
    with pytest.raises(ToolError, match="no schedule"):
        recurring_tools.skip_recurring_occurrence(USER_ID, str(seeded["label_only"].id))


def test_an_idempotency_key_stops_a_retry_skipping_twice(seeded, db_session):
    recurring_tools.skip_recurring_occurrence(
        USER_ID, str(seeded["scheduled"].id), idempotency_key="skip-1"
    )
    second = recurring_tools.skip_recurring_occurrence(
        USER_ID, str(seeded["scheduled"].id), idempotency_key="skip-1"
    )

    assert second["idempotent_replay"] is True
    db_session.expire_all()
    assert db_session.query(RecurringTransaction).filter_by(
        id=seeded["scheduled"].id
    ).one().next_due_date == date(2026, 10, 1)
