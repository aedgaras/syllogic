"""What a write tool owes a caller that cannot see the database.

An agent driving these tools is acting on rows the user has not looked at,
and it has three blind spots the tools themselves have to cover.

**It cannot show the change before making it.** So every write takes
`dry_run`, and the preview is built by applying the write and rolling it
back rather than by describing it. The difference matters: a "would set
amount to -5" string cannot notice a constraint, and a preview that misses
constraints tells the agent the call will succeed right until it doesn't.

**It cannot tell a lost response from a failed call.** So the create and
update tools take `idempotency_key`, and retrying with the same key replays
rather than writes. Reusing a key for a *different* call is a client bug and
is rejected, because both ways of resolving it silently would hide it.

**It cannot tell a write from a no-op.** So single-entity writes report
`changed`, `before` and `after`, and an agent can say "already set to 400"
instead of claiming an edit it did not make.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import budgets as budget_tools
from app.mcp.tools import categories as category_tools
from app.mcp.tools import reports as report_tools
from app.mcp.tools import transactions as tx_tools
from app.models import (
    Account,
    Budget,
    BudgetCategory,
    Category,
    MCPIdempotencyKey,
    Report,
    Transaction,
    User,
)


USER_ID = "write-safety-user"


@pytest.fixture
def seeded(db_session):
    """One of everything the write tools operate on."""
    user = User(id=USER_ID, email="ws@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    account = Account(user_id=user.id, name="Main", account_type="checking", currency="EUR")
    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    dining = Category(user_id=user.id, name="Dining", category_type="expense")
    db_session.add_all([account, groceries, dining])
    db_session.flush()

    txn = Transaction(
        user_id=user.id,
        account_id=account.id,
        amount=Decimal("-25.00"),
        currency="EUR",
        functional_amount=Decimal("-25.00"),
        transaction_type="debit",
        description="Market",
        merchant="Market",
        booked_at=datetime(2026, 9, 10),
        category_id=groceries.id,
    )
    budget = Budget(
        user_id=user.id,
        name="Food",
        amount=Decimal("400.00"),
        currency="EUR",
        period="monthly",
        is_active=True,
    )
    db_session.add_all([txn, budget])
    db_session.flush()
    db_session.add(BudgetCategory(budget_id=budget.id, category_id=groceries.id))

    report = Report(
        user_id=user.id,
        name="Weekly",
        frequency="WEEKLY",
        send_day_of_week=0,
        recipient_emails=["me@example.com"],
        account_ids=[],
        transaction_mode="RECENT",
        transaction_count=10,
        transaction_direction="ALL",
        timezone="UTC",
        is_active=True,
    )
    db_session.add(report)
    db_session.commit()
    return {
        "user": user,
        "account": account,
        "groceries": groceries,
        "dining": dining,
        "txn": txn,
        "budget": budget,
        "report": report,
    }


# ---------------------------------------------------------------------------
# Every write tool, and the change each one makes
# ---------------------------------------------------------------------------
#
# (name, call, row_model) -- `call` takes the seeded fixture and dry_run and
# performs a real change; `row_model` is the table whose row count must not
# move during a preview.

WRITES = [
    (
        "update_category",
        lambda s, dry: category_tools.update_category(
            USER_ID, str(s["groceries"].id), description="changed", dry_run=dry
        ),
        Category,
    ),
    (
        "update_transaction_category",
        lambda s, dry: tx_tools.update_transaction_category(
            USER_ID, str(s["txn"].id), str(s["dining"].id), dry_run=dry
        ),
        Transaction,
    ),
    (
        "bulk_update_transaction_categories",
        lambda s, dry: tx_tools.bulk_update_transaction_categories(
            USER_ID, str(s["dining"].id), [str(s["txn"].id)], dry_run=dry
        ),
        Transaction,
    ),
    (
        "create_budget",
        lambda s, dry: budget_tools.create_budget(
            USER_ID, "Second", 100.0, categories=[{"category_id": str(s["dining"].id)}], dry_run=dry
        ),
        Budget,
    ),
    (
        "update_budget",
        lambda s, dry: budget_tools.update_budget(
            USER_ID, str(s["budget"].id), amount=550.0, dry_run=dry
        ),
        Budget,
    ),
    (
        "set_budget_categories",
        lambda s, dry: budget_tools.set_budget_categories(
            USER_ID, str(s["budget"].id), [{"category_id": str(s["dining"].id)}], dry_run=dry
        ),
        BudgetCategory,
    ),
    (
        "delete_budget",
        lambda s, dry: budget_tools.delete_budget(USER_ID, str(s["budget"].id), dry_run=dry),
        Budget,
    ),
    (
        "create_report",
        lambda s, dry: report_tools.create_report(
            USER_ID, "Daily", "DAILY", ["me@example.com"], dry_run=dry
        ),
        Report,
    ),
    (
        "update_report",
        lambda s, dry: report_tools.update_report(
            USER_ID, str(s["report"].id), is_active=False, dry_run=dry
        ),
        Report,
    ),
    (
        "delete_report",
        lambda s, dry: report_tools.delete_report(USER_ID, str(s["report"].id), dry_run=dry),
        Report,
    ),
]

WRITE_IDS = [name for name, _, _ in WRITES]


# ---------------------------------------------------------------------------
# dry_run
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name,call,model", WRITES, ids=WRITE_IDS)
def test_dry_run_leaves_the_table_exactly_as_it_found_it(name, call, model, seeded, db_session):
    before_count = db_session.query(model).count()
    before_rows = {
        str(r.id if hasattr(r, "id") else (r.budget_id, r.category_id)): getattr(
            r, "updated_at", None
        )
        for r in db_session.query(model).all()
    }

    call(seeded, True)

    db_session.expire_all()
    assert db_session.query(model).count() == before_count
    after_rows = {
        str(r.id if hasattr(r, "id") else (r.budget_id, r.category_id)): getattr(
            r, "updated_at", None
        )
        for r in db_session.query(model).all()
    }
    assert after_rows == before_rows


@pytest.mark.parametrize("name,call,model", WRITES, ids=WRITE_IDS)
def test_dry_run_says_it_did_not_commit(name, call, model, seeded):
    result = call(seeded, True)
    assert result["dry_run"] is True
    assert result["committed"] is False


@pytest.mark.parametrize("name,call,model", WRITES, ids=WRITE_IDS)
def test_a_real_call_says_it_did(name, call, model, seeded):
    result = call(seeded, False)
    assert result["dry_run"] is False
    assert result["committed"] is True


def test_dry_run_still_raises_on_invalid_input(seeded):
    """The error has to arrive during the preview, not be deferred to the
    real call -- an agent that previews cleanly and then fails has learned
    nothing from previewing."""
    with pytest.raises(ToolError, match="greater than 0"):
        budget_tools.create_budget(USER_ID, "Bad", -5.0, dry_run=True)

    with pytest.raises(ToolError):
        budget_tools.update_budget(
            USER_ID, "00000000-0000-0000-0000-000000000000", amount=5, dry_run=True
        )

    with pytest.raises(ToolError, match="frequency"):
        report_tools.create_report(USER_ID, "Bad", "YEARLY", ["me@example.com"], dry_run=True)


def test_dry_run_preview_matches_what_the_real_call_returns(seeded):
    preview = budget_tools.update_budget(
        USER_ID, str(seeded["budget"].id), amount=550.0, dry_run=True
    )
    real = budget_tools.update_budget(USER_ID, str(seeded["budget"].id), amount=550.0)

    assert preview["before"] == real["before"]
    assert preview["after"] == real["after"]
    assert preview["budget"]["amount"] == real["budget"]["amount"] == 550.0


def test_delete_dry_run_says_what_would_be_destroyed(seeded):
    result = budget_tools.delete_budget(USER_ID, str(seeded["budget"].id), dry_run=True)

    assert result["deleted_budget"]["name"] == "Food"
    # The memberships cascade with it, so they are named too.
    assert result["deleted_budget"]["category_ids"] == [str(seeded["groceries"].id)]


def test_send_test_report_dry_run_does_not_touch_the_queue(seeded):
    """The one write whose effect cannot be rolled back. A transaction does
    not un-send an email, so this dry run writes nothing at all."""
    with patch("app.services.report_service.send_report_run") as mock_task:
        result = report_tools.send_test_report(USER_ID, str(seeded["report"].id), dry_run=True)

    mock_task.delay.assert_not_called()
    assert result["would_send_to"] == ["me@example.com"]
    assert result["subject"].startswith("Weekly")
    assert result["quota_remaining"] > 0


# ---------------------------------------------------------------------------
# changed / before / after
# ---------------------------------------------------------------------------


def test_a_no_op_write_reports_itself_as_one(seeded):
    """The reason this exists: without it an agent says "I've updated that"
    whether or not anything moved."""
    budget_tools.update_budget(USER_ID, str(seeded["budget"].id), amount=550.0)
    again = budget_tools.update_budget(USER_ID, str(seeded["budget"].id), amount=550.0)

    assert again["changed"] is False
    assert again["before"] == again["after"]
    assert again["fields_changed"] == []


def test_a_real_write_names_the_fields_it_changed(seeded):
    result = budget_tools.update_budget(USER_ID, str(seeded["budget"].id), amount=550.0)

    assert result["changed"] is True
    assert result["fields_changed"] == ["amount"]
    assert result["before"]["amount"] == 400.0
    assert result["after"]["amount"] == 550.0


def test_category_no_op_reports_itself_as_one(seeded):
    category_tools.update_category(USER_ID, str(seeded["groceries"].id), description="x")
    again = category_tools.update_category(USER_ID, str(seeded["groceries"].id), description="x")

    assert again["changed"] is False
    assert again["fields_changed"] == []


def test_transaction_category_no_op_reports_itself_as_one(seeded):
    txn_id = str(seeded["txn"].id)
    tx_tools.update_transaction_category(USER_ID, txn_id, str(seeded["dining"].id))
    again = tx_tools.update_transaction_category(USER_ID, txn_id, str(seeded["dining"].id))

    assert again["changed"] is False


# ---------------------------------------------------------------------------
# idempotency_key
# ---------------------------------------------------------------------------


KEYED = [
    (
        "create_budget",
        lambda key: budget_tools.create_budget(USER_ID, "Keyed", 100.0, idempotency_key=key),
        lambda key: budget_tools.create_budget(
            USER_ID, "Keyed but different", 100.0, idempotency_key=key
        ),
        Budget,
    ),
    (
        "create_report",
        lambda key: report_tools.create_report(
            USER_ID, "Keyed", "DAILY", ["me@example.com"], idempotency_key=key
        ),
        lambda key: report_tools.create_report(
            USER_ID, "Keyed but different", "DAILY", ["me@example.com"], idempotency_key=key
        ),
        Report,
    ),
]

KEYED_IDS = [name for name, _, _, _ in KEYED]


@pytest.mark.parametrize("name,call,other_call,model", KEYED, ids=KEYED_IDS)
def test_the_same_key_twice_writes_once(name, call, other_call, model, seeded, db_session):
    before = db_session.query(model).count()

    first = call("key-1")
    second = call("key-1")

    db_session.expire_all()
    assert db_session.query(model).count() == before + 1
    assert second.get("idempotent_replay") is True
    assert "idempotent_replay" not in first


@pytest.mark.parametrize("name,call,other_call,model", KEYED, ids=KEYED_IDS)
def test_the_replay_is_the_first_response(name, call, other_call, model, seeded):
    first = call("key-2")
    second = call("key-2")

    assert {k: v for k, v in second.items() if k != "idempotent_replay"} == first


@pytest.mark.parametrize("name,call,other_call,model", KEYED, ids=KEYED_IDS)
def test_the_same_key_with_different_arguments_is_rejected(
    name, call, other_call, model, seeded, db_session
):
    """Replaying would misreport what was asked for; executing would defeat
    the key. Both hide a client bug the caller can fix."""
    call("key-3")
    before = db_session.query(model).count()

    with pytest.raises(ToolError, match="different arguments"):
        other_call("key-3")

    db_session.expire_all()
    assert db_session.query(model).count() == before


def test_no_key_means_no_stored_row(seeded, db_session):
    budget_tools.create_budget(USER_ID, "Unkeyed", 100.0)
    assert db_session.query(MCPIdempotencyKey).count() == 0


def test_a_dry_run_does_not_consume_a_key(seeded, db_session):
    """A preview is a question, not a call to remember. Storing its response
    would make the real call that follows replay the preview."""
    budget_tools.create_budget(USER_ID, "Keyed", 100.0, idempotency_key="key-4", dry_run=True)
    assert db_session.query(MCPIdempotencyKey).count() == 0

    real = budget_tools.create_budget(USER_ID, "Keyed", 100.0, idempotency_key="key-4")
    assert real["committed"] is True
    assert "idempotent_replay" not in real


def test_keys_are_scoped_to_one_tool(seeded, db_session):
    """The same key used against a different tool is a different call."""
    budget_tools.create_budget(USER_ID, "Keyed", 100.0, idempotency_key="shared")
    report = report_tools.create_report(
        USER_ID, "Keyed", "DAILY", ["me@example.com"], idempotency_key="shared"
    )

    assert "idempotent_replay" not in report
    assert db_session.query(MCPIdempotencyKey).count() == 2
