"""Booking, editing and deleting transactions through the MCP tools.

Reading a ledger is safe; writing to one is not, and the three things that
go wrong here are specific.

**A row is not a balance.** `POST /api/transactions` inserts and stops,
leaving `functional_amount` null and the account's balance where it was
until the next sync. An agent that books an expense and then reports the
balance would be reading a number that does not include what it just wrote,
so these tools go through TransactionMutationService, which recalculates.

**The sign is not the caller's to choose.** `amount` is a magnitude and the
direction comes from `transaction_type`. A signed amount that arrives with
the wrong sign produces a plausible row nothing downstream can question.

**A transfer is not two transactions.** Booked as a plain pair it becomes the
month's largest expense plus an equal windfall, and every spending figure
after it is wrong.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import transactions as tx_tools
from app.models import Account, Category, MCPIdempotencyKey, Transaction, User


USER_ID = "tx-write-user"


@pytest.fixture
def seeded(db_session):
    user = User(id=USER_ID, email="txw@test.com", functional_currency="EUR")
    # A second user, so "not yours" can be tested against a real row rather
    # than only against an id that does not exist anywhere.
    stranger = User(id="someone-else", email="stranger@test.com", functional_currency="EUR")
    db_session.add_all([user, stranger])
    db_session.flush()

    main = Account(
        user_id=user.id,
        name="Main",
        account_type="checking",
        currency="EUR",
        starting_balance=Decimal("1000.00"),
        functional_balance=Decimal("1000.00"),
    )
    savings = Account(
        user_id=user.id,
        name="Savings",
        account_type="savings",
        currency="EUR",
        starting_balance=Decimal("5000.00"),
        functional_balance=Decimal("5000.00"),
    )
    other_users_account = Account(
        user_id="someone-else", name="Theirs", account_type="checking", currency="EUR"
    )
    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    salary = Category(user_id=user.id, name="Salary", category_type="income")
    db_session.add_all([main, savings, other_users_account, groceries, salary])
    db_session.flush()

    existing = Transaction(
        user_id=user.id,
        account_id=main.id,
        amount=Decimal("-25.00"),
        currency="EUR",
        functional_amount=Decimal("-25.00"),
        transaction_type="debit",
        description="Market",
        merchant="Market",
        booked_at=datetime(2026, 9, 10, tzinfo=timezone.utc),
        category_id=groceries.id,
        include_in_analytics=True,
    )
    db_session.add(existing)
    db_session.commit()
    return {
        "main": main,
        "savings": savings,
        "theirs": other_users_account,
        "groceries": groceries,
        "salary": salary,
        "txn": existing,
    }


def _rows(db_session, account) -> list[Transaction]:
    return (
        db_session.query(Transaction)
        .filter(Transaction.account_id == account.id)
        .order_by(Transaction.booked_at)
        .all()
    )


# ---------------------------------------------------------------------------
# create_transaction
# ---------------------------------------------------------------------------


def test_an_expense_is_booked_negative(seeded, db_session):
    result = tx_tools.create_transaction(
        USER_ID,
        str(seeded["main"].id),
        42.50,
        "Weekly shop",
        booked_at="2026-09-15",
        category_id=str(seeded["groceries"].id),
    )

    assert result["committed"] is True
    assert result["transaction"]["amount"] == -42.50
    assert result["transaction"]["transaction_type"] == "debit"
    assert result["transaction"]["category_name"] == "Groceries"


def test_income_is_booked_positive(seeded):
    result = tx_tools.create_transaction(
        USER_ID,
        str(seeded["main"].id),
        2000.0,
        "September pay",
        transaction_type="income",
        booked_at="2026-09-25",
        category_id=str(seeded["salary"].id),
    )

    assert result["transaction"]["amount"] == 2000.0
    assert result["transaction"]["transaction_type"] == "credit"


def test_expense_and_income_are_accepted_as_aliases(seeded):
    """The ledger says debit/credit; a caller means expense/income. Rejecting
    the second spelling buys a retry with a guess and nothing else."""
    debit = tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 5.0, "A", transaction_type="expense"
    )
    credit = tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 5.0, "B", transaction_type="credit"
    )

    assert debit["transaction"]["transaction_type"] == "debit"
    assert credit["transaction"]["transaction_type"] == "credit"


def test_a_negative_amount_is_refused_rather_than_negated(seeded):
    """Both readings are defensible and they book opposite rows, so neither
    can be chosen silently."""
    with pytest.raises(ToolError, match="positive"):
        tx_tools.create_transaction(USER_ID, str(seeded["main"].id), -42.50, "Weekly shop")


def test_the_account_balance_moves_with_the_new_row(seeded, db_session):
    """The plain REST create leaves the balance where it was until the next
    sync, which would make an agent's own report of the balance wrong."""
    tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 100.0, "Big shop", booked_at="2026-09-15"
    )

    db_session.expire_all()
    account = db_session.query(Account).filter(Account.id == seeded["main"].id).first()
    # 1000 starting - 25 seeded - 100 new
    assert account.functional_balance == Decimal("875.00")


def test_the_functional_amount_is_filled_in(seeded):
    """Null functional_amount is what every analytics total silently drops."""
    result = tx_tools.create_transaction(USER_ID, str(seeded["main"].id), 30.0, "Lunch")

    assert result["transaction"]["functional_amount"] == -30.0


def test_booked_at_defaults_to_today(seeded):
    result = tx_tools.create_transaction(USER_ID, str(seeded["main"].id), 8.0, "Coffee")

    booked = datetime.fromisoformat(result["transaction"]["booked_at"])
    assert booked.date() == datetime.now(timezone.utc).date()


def test_a_blank_description_is_refused(seeded):
    with pytest.raises(ToolError, match="description"):
        tx_tools.create_transaction(USER_ID, str(seeded["main"].id), 10.0, "   ")


def test_another_users_account_is_not_found_rather_than_written_to(seeded, db_session):
    with pytest.raises(ToolError, match="No account found"):
        tx_tools.create_transaction(USER_ID, str(seeded["theirs"].id), 10.0, "Nope")

    assert (
        db_session.query(Transaction).filter(Transaction.account_id == seeded["theirs"].id).count()
        == 0
    )


def test_an_unknown_category_names_the_ones_that_exist(seeded):
    with pytest.raises(ToolError, match="Groceries"):
        tx_tools.create_transaction(
            USER_ID,
            str(seeded["main"].id),
            10.0,
            "Shop",
            category_id="00000000-0000-0000-0000-000000000000",
        )


def test_create_dry_run_writes_nothing(seeded, db_session):
    before = db_session.query(Transaction).count()

    result = tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 42.50, "Weekly shop", dry_run=True
    )

    db_session.expire_all()
    assert result["committed"] is False
    assert result["transaction"]["amount"] == -42.50
    assert db_session.query(Transaction).count() == before
    account = db_session.query(Account).filter(Account.id == seeded["main"].id).first()
    assert account.functional_balance == Decimal("1000.00")


def test_create_retried_with_the_same_key_books_once(seeded, db_session):
    first = tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 42.50, "Weekly shop", idempotency_key="k1"
    )
    second = tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 42.50, "Weekly shop", idempotency_key="k1"
    )

    db_session.expire_all()
    assert second["idempotent_replay"] is True
    assert second["transaction"]["id"] == first["transaction"]["id"]
    assert (
        db_session.query(Transaction).filter(Transaction.description == "Weekly shop").count() == 1
    )


def test_a_create_dry_run_does_not_consume_a_key(seeded, db_session):
    tx_tools.create_transaction(
        USER_ID, str(seeded["main"].id), 42.50, "Weekly shop", dry_run=True, idempotency_key="k2"
    )

    db_session.expire_all()
    assert db_session.query(MCPIdempotencyKey).count() == 0


# ---------------------------------------------------------------------------
# update_transaction
# ---------------------------------------------------------------------------


def test_editing_the_amount_keeps_the_direction(seeded):
    result = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), amount=30.0)

    assert result["changed"] is True
    assert result["after"]["amount"] == -30.0
    assert "amount" in result["fields_changed"]


def test_editing_a_field_to_its_current_value_is_reported_as_a_no_op(seeded):
    """ "Already called that" is the correct thing to tell the user, and a
    tool that answers with the new state alone cannot say it."""
    result = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), description="Market")

    assert result["changed"] is False
    assert result["fields_changed"] == []


def test_an_edit_can_flip_an_expense_to_income(seeded):
    result = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), transaction_type="income")

    assert result["after"]["transaction_type"] == "credit"
    assert result["after"]["amount"] == 25.0


def test_moving_a_transaction_between_accounts_recalculates_both(seeded, db_session):
    tx_tools.update_transaction(
        USER_ID, str(seeded["txn"].id), account_id=str(seeded["savings"].id)
    )

    db_session.expire_all()
    main = db_session.query(Account).filter(Account.id == seeded["main"].id).first()
    savings = db_session.query(Account).filter(Account.id == seeded["savings"].id).first()
    assert main.functional_balance == Decimal("1000.00")
    assert savings.functional_balance == Decimal("4975.00")


def test_the_category_can_be_cleared_with_an_empty_string(seeded):
    result = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), category_id="")

    assert result["after"]["category_id"] is None


def test_the_analytics_flag_is_settable_in_the_same_call(seeded):
    """Otherwise "and don't count this as spending" costs a second round
    trip, and the REST surface spends one endpoint on it."""
    result = tx_tools.update_transaction(
        USER_ID, str(seeded["txn"].id), merchant="Market BV", include_in_analytics=False
    )

    assert result["after"]["include_in_analytics"] is False
    assert result["after"]["merchant"] == "Market BV"


def test_an_edit_naming_no_field_is_refused(seeded):
    with pytest.raises(ToolError, match="field"):
        tx_tools.update_transaction(USER_ID, str(seeded["txn"].id))


def test_editing_an_unknown_transaction_raises(seeded):
    with pytest.raises(ToolError, match="No transaction found"):
        tx_tools.update_transaction(USER_ID, "00000000-0000-0000-0000-000000000000", amount=1.0)


def test_update_dry_run_leaves_the_row_alone(seeded, db_session):
    result = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), amount=30.0, dry_run=True)

    db_session.expire_all()
    row = db_session.query(Transaction).filter(Transaction.id == seeded["txn"].id).first()
    assert result["after"]["amount"] == -30.0
    assert result["committed"] is False
    assert row.amount == Decimal("-25.00")


def test_update_preview_matches_the_real_call(seeded):
    preview = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), amount=30.0, dry_run=True)
    real = tx_tools.update_transaction(USER_ID, str(seeded["txn"].id), amount=30.0)

    assert preview["before"] == real["before"]
    assert preview["after"] == real["after"]


# ---------------------------------------------------------------------------
# delete_transactions
# ---------------------------------------------------------------------------


def test_delete_removes_the_row_and_restores_the_balance(seeded, db_session):
    txn_id = seeded["txn"].id

    result = tx_tools.delete_transactions(USER_ID, [str(txn_id)])

    db_session.expire_all()
    assert result["deleted_count"] == 1
    assert db_session.query(Transaction).filter(Transaction.id == txn_id).count() == 0
    account = db_session.query(Account).filter(Account.id == seeded["main"].id).first()
    assert account.functional_balance == Decimal("1000.00")


def test_delete_dry_run_says_what_would_be_destroyed(seeded, db_session):
    result = tx_tools.delete_transactions(USER_ID, [str(seeded["txn"].id)], dry_run=True)

    db_session.expire_all()
    assert result["committed"] is False
    assert result["deleted_transactions"][0]["description"] == "Market"
    assert result["account_impacts"][0]["projected_balance"] == 1000.0
    assert db_session.query(Transaction).filter(Transaction.id == seeded["txn"].id).count() == 1


def test_delete_takes_both_sides_of_a_transfer(seeded, db_session):
    """Deleting one side alone leaves the other as unexplained income."""
    transfer = tx_tools.create_transfer(
        USER_ID, str(seeded["main"].id), str(seeded["savings"].id), 100.0, "To savings"
    )
    source_id = transfer["source_transaction"]["id"]

    result = tx_tools.delete_transactions(USER_ID, [source_id])

    db_session.expire_all()
    assert result["deleted_count"] == 2
    assert len(result["linked_transfer_ids"]) == 1
    assert (
        db_session.query(Transaction)
        .filter(Transaction.id == transfer["destination_transaction"]["id"])
        .count()
        == 0
    )


def test_delete_reports_ids_it_could_not_find(seeded):
    missing = "00000000-0000-0000-0000-000000000000"
    result = tx_tools.delete_transactions(USER_ID, [str(seeded["txn"].id), missing])

    assert result["deleted_count"] == 1
    assert result["not_found_ids"] == [missing]


def test_deleting_nothing_at_all_is_refused(seeded):
    with pytest.raises(ToolError, match="transaction_ids"):
        tx_tools.delete_transactions(USER_ID, [])


def test_another_users_transaction_cannot_be_deleted(seeded, db_session):
    theirs = Transaction(
        user_id="someone-else",
        account_id=seeded["theirs"].id,
        amount=Decimal("-5.00"),
        currency="EUR",
        transaction_type="debit",
        description="Not yours",
        booked_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
    )
    db_session.add(theirs)
    db_session.commit()

    with pytest.raises(ToolError, match="No transaction found"):
        tx_tools.delete_transactions(USER_ID, [str(theirs.id)])

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.id == theirs.id).count() == 1


# ---------------------------------------------------------------------------
# create_transfer
# ---------------------------------------------------------------------------


def test_a_transfer_books_both_sides(seeded, db_session):
    result = tx_tools.create_transfer(
        USER_ID, str(seeded["main"].id), str(seeded["savings"].id), 250.0, "To savings"
    )

    assert result["source_transaction"]["amount"] == -250.0
    assert result["destination_transaction"]["amount"] == 250.0

    db_session.expire_all()
    main = db_session.query(Account).filter(Account.id == seeded["main"].id).first()
    savings = db_session.query(Account).filter(Account.id == seeded["savings"].id).first()
    assert main.functional_balance == Decimal("725.00")
    assert savings.functional_balance == Decimal("5250.00")


def test_neither_side_of_a_transfer_counts_as_spending(seeded):
    """Booked as a plain pair it would be the month's largest expense and an
    equal windfall."""
    result = tx_tools.create_transfer(
        USER_ID, str(seeded["main"].id), str(seeded["savings"].id), 250.0, "To savings"
    )

    assert result["source_transaction"]["include_in_analytics"] is False
    assert result["destination_transaction"]["include_in_analytics"] is False


def test_a_transfer_to_the_same_account_is_refused(seeded):
    with pytest.raises(ToolError, match="different"):
        tx_tools.create_transfer(
            USER_ID, str(seeded["main"].id), str(seeded["main"].id), 250.0, "Nowhere"
        )


def test_transfer_dry_run_writes_neither_side(seeded, db_session):
    before = db_session.query(Transaction).count()

    result = tx_tools.create_transfer(
        USER_ID,
        str(seeded["main"].id),
        str(seeded["savings"].id),
        250.0,
        "To savings",
        dry_run=True,
    )

    db_session.expire_all()
    assert result["committed"] is False
    assert db_session.query(Transaction).count() == before
