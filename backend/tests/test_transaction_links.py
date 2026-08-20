"""
Tests for backend/app/routes/transaction_links.py — the new router backing
lib/actions/transaction-links.ts's migration off Drizzle (create/add/remove/
delete groups, group lookup, reimbursement/expense suggestion search,
link-info, and selection-based group creation).

Run with:
    cd backend && pytest tests/test_transaction_links.py -v
"""

import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import HTTPException

from app.database import SessionLocal, Base, engine
from app.models import Account, Transaction, TransactionLink
from app.db_helpers import get_or_create_system_user
from app.routes.transaction_links import (
    add_to_link_group,
    create_link_group,
    create_link_group_from_selection,
    delete_link_group,
    find_potential_expenses,
    find_potential_reimbursements,
    get_transaction_link_group,
    get_transaction_link_info,
    get_user_link_groups,
    remove_transaction_from_link_group,
)
from app.schemas import (
    AddToLinkGroupRequest,
    CreateLinkGroupFromSelectionRequest,
    CreateLinkGroupRequest,
)


@pytest.fixture
def user_id():
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=engine)
        user = get_or_create_system_user(db)
        return str(user.id)
    finally:
        db.close()


def _unique(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def _seed_account(db, user_id: str, **overrides) -> str:
    defaults = dict(
        user_id=user_id,
        name=_unique("Account"),
        account_type="checking",
        currency="EUR",
        provider="manual",
        starting_balance=Decimal("0"),
        functional_balance=Decimal("0"),
        is_active=True,
    )
    defaults.update(overrides)
    account = Account(**defaults)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account.id


def _seed_transaction(db, user_id: str, account_id, amount, booked_at=None, **overrides) -> str:
    defaults = dict(
        user_id=user_id,
        account_id=account_id,
        transaction_type="debit" if Decimal(str(amount)) < 0 else "credit",
        amount=amount,
        currency="EUR",
        description="test txn",
        booked_at=booked_at or datetime(2024, 1, 1),
    )
    defaults.update(overrides)
    txn = Transaction(**defaults)
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn.id


def _cleanup(*, account_ids=(), group_ids=()):
    db = SessionLocal()
    try:
        if group_ids:
            db.query(TransactionLink).filter(TransactionLink.group_id.in_(group_ids)).delete(
                synchronize_session=False
            )
        if account_ids:
            db.query(Transaction).filter(Transaction.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Account).filter(Account.id.in_(account_ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_create_link_group_generates_server_side_id_and_rejects_duplicates(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked = _seed_transaction(db, user_id, account, "40.00")
    try:
        result = create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        assert result.group_id is not None

        with pytest.raises(HTTPException) as exc_info:
            create_link_group(
                CreateLinkGroupRequest(
                    primary_id=primary, linked_ids=[linked], link_type="reimbursement"
                ),
                user_id=user_id,
                db=db,
            )
        assert exc_info.value.status_code == 409

        group = get_transaction_link_group(primary, user_id=user_id, db=db)
        assert group is not None
        assert group.primary.id == primary
        assert [item.id for item in group.linked] == [linked]
        assert group.net_amount == pytest.approx(-60.00)
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_add_to_link_group_rejects_already_linked_transaction(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked = _seed_transaction(db, user_id, account, "40.00")
    other = _seed_transaction(db, user_id, account, "20.00")
    try:
        result = create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        group_id = result.group_id

        add_to_link_group(
            group_id,
            AddToLinkGroupRequest(transaction_id=other, role="reimbursement"),
            user_id=user_id,
            db=db,
        )
        group = get_transaction_link_group(primary, user_id=user_id, db=db)
        assert {item.id for item in group.linked} == {linked, other}

        with pytest.raises(HTTPException) as exc_info:
            add_to_link_group(
                group_id,
                AddToLinkGroupRequest(transaction_id=other, role="reimbursement"),
                user_id=user_id,
                db=db,
            )
        assert exc_info.value.status_code == 409
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_remove_transaction_deletes_whole_group_at_threshold(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked_a = _seed_transaction(db, user_id, account, "40.00")
    linked_b = _seed_transaction(db, user_id, account, "60.00")
    try:
        result = create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked_a, linked_b], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        group_id = result.group_id

        # 3-member group: removing one non-primary leaves 2 -> group survives.
        outcome = remove_transaction_from_link_group(linked_a, user_id=user_id, db=db)
        assert outcome.group_deleted is False
        group = get_transaction_link_group(primary, user_id=user_id, db=db)
        assert [item.id for item in group.linked] == [linked_b]

        # 2-member group: removing the last non-primary deletes the whole group.
        outcome = remove_transaction_from_link_group(linked_b, user_id=user_id, db=db)
        assert outcome.group_deleted is True
        assert get_transaction_link_group(primary, user_id=user_id, db=db) is None
        assert get_transaction_link_info(primary, user_id=user_id, db=db) is None
        _ = group_id
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_remove_primary_always_deletes_group(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked_a = _seed_transaction(db, user_id, account, "40.00")
    linked_b = _seed_transaction(db, user_id, account, "60.00")
    try:
        create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked_a, linked_b], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        outcome = remove_transaction_from_link_group(primary, user_id=user_id, db=db)
        assert outcome.group_deleted is True
        assert get_transaction_link_info(linked_a, user_id=user_id, db=db) is None
        assert get_transaction_link_info(linked_b, user_id=user_id, db=db) is None
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_delete_link_group_removes_all_members(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked = _seed_transaction(db, user_id, account, "40.00")
    try:
        result = create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        delete_link_group(result.group_id, user_id=user_id, db=db)
        assert get_transaction_link_info(primary, user_id=user_id, db=db) is None
        assert get_transaction_link_info(linked, user_id=user_id, db=db) is None

        with pytest.raises(HTTPException) as exc_info:
            delete_link_group(result.group_id, user_id=user_id, db=db)
        assert exc_info.value.status_code == 404
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_get_user_link_groups_includes_created_group(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    primary = _seed_transaction(db, user_id, account, "-100.00")
    linked = _seed_transaction(db, user_id, account, "40.00")
    try:
        result = create_link_group(
            CreateLinkGroupRequest(
                primary_id=primary, linked_ids=[linked], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        groups = get_user_link_groups(user_id=user_id, db=db)
        assert any(group.group_id == result.group_id for group in groups)
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_find_potential_reimbursements_filters_by_account_and_excludes_linked(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    other_account = _seed_account(db, user_id)
    expense = _seed_transaction(db, user_id, account, "-50.00")
    matching_credit = _seed_transaction(db, user_id, account, "30.00")
    already_linked_credit = _seed_transaction(db, user_id, account, "10.00")
    other_account_credit = _seed_transaction(db, user_id, other_account, "20.00")
    try:
        create_link_group(
            CreateLinkGroupRequest(
                primary_id=expense, linked_ids=[already_linked_credit], link_type="reimbursement"
            ),
            user_id=user_id,
            db=db,
        )
        result = find_potential_reimbursements(
            expense,
            search=None,
            account_id=account,
            date_from=None,
            date_to=None,
            min_amount=None,
            max_amount=None,
            page=1,
            page_size=50,
            user_id=user_id,
            db=db,
        )
        ids = {item.id for item in result.transactions}
        assert ids == {matching_credit}
        assert other_account_credit not in ids
        assert already_linked_credit not in ids

        # A credit source transaction has no reimbursements (only expenses do).
        credit_result = find_potential_reimbursements(
            matching_credit,
            search=None,
            account_id=None,
            date_from=None,
            date_to=None,
            min_amount=None,
            max_amount=None,
            page=1,
            page_size=50,
            user_id=user_id,
            db=db,
        )
        assert credit_result.transactions == []
    finally:
        db.close()
        _cleanup(account_ids=[account, other_account])


def test_find_potential_expenses_mirrors_reimbursements_for_income(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    income = _seed_transaction(db, user_id, account, "100.00")
    matching_debit = _seed_transaction(db, user_id, account, "-25.00")
    try:
        result = find_potential_expenses(
            income,
            search=None,
            account_id=account,
            date_from=None,
            date_to=None,
            min_amount=None,
            max_amount=None,
            page=1,
            page_size=50,
            user_id=user_id,
            db=db,
        )
        assert [item.id for item in result.transactions] == [matching_debit]
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_create_link_group_from_selection_picks_largest_absolute_amount_as_primary(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    biggest = _seed_transaction(db, user_id, account, "-200.00")
    small_a = _seed_transaction(db, user_id, account, "50.00")
    small_b = _seed_transaction(db, user_id, account, "60.00")
    try:
        result = create_link_group_from_selection(
            CreateLinkGroupFromSelectionRequest(transaction_ids=[biggest, small_a, small_b]),
            user_id=user_id,
            db=db,
        )
        group = get_transaction_link_group(biggest, user_id=user_id, db=db)
        assert group.primary.id == biggest
        assert {item.id for item in group.linked} == {small_a, small_b}
        # Negative primary -> reimbursement role for the rest.
        assert all(item.link_role == "reimbursement" for item in group.linked)
        _ = result
    finally:
        db.close()
        _cleanup(account_ids=[account])
