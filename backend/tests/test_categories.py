"""
Tests for the categories CRUD routes (backend/app/routes/categories.py).

Exercises the route functions directly against the database (no HTTP),
mirroring the setup style used in test_mcp_update_category.py. Auth is
simulated by setting the internal-auth request_user_id contextvar, the same
value internal_auth_middleware would set from a verified HMAC request.
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import HTTPException

from app.database import SessionLocal, Base, engine
from app.models import Account, Category, Transaction
from app.db_helpers import get_or_create_system_user, set_request_user_id, clear_request_user_id
from app.routes.categories import (
    create_category,
    update_category,
    delete_category,
)
from app.schemas import CategoryCreate, CategoryUpdate, CategoryDeleteRequest


@pytest.fixture
def user_id():
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=engine)
        user = get_or_create_system_user(db)
        uid = str(user.id)
    finally:
        db.close()

    token = set_request_user_id(uid)
    try:
        yield uid
    finally:
        clear_request_user_id(token)


def _unique(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def _seed_category(db, user_id: str, **overrides) -> Category:
    defaults = dict(
        user_id=user_id,
        name=_unique("Cat"),
        category_type="expense",
        is_system=False,
    )
    defaults.update(overrides)
    cat = Category(**defaults)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _cleanup(*, category_ids=(), account_ids=()):
    db = SessionLocal()
    try:
        if category_ids:
            db.query(Transaction).filter(Transaction.category_id.in_(category_ids)).update(
                {"category_id": None}, synchronize_session=False
            )
            db.query(Transaction).filter(Transaction.category_system_id.in_(category_ids)).update(
                {"category_system_id": None}, synchronize_session=False
            )
            db.query(Category).filter(Category.id.in_(category_ids)).delete(
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


def test_create_category_rejects_duplicate_name(user_id, db_session):
    name = _unique("Groceries")
    cat = _seed_category(db_session, user_id, name=name, category_type="expense")
    try:
        with pytest.raises(HTTPException) as exc_info:
            create_category(
                CategoryCreate(name=name, category_type="expense", color="#fff", icon="x"),
                db=db_session,
            )
        assert exc_info.value.status_code == 409
    finally:
        _cleanup(category_ids=[cat.id])


def test_create_category_allows_same_name_different_type(user_id, db_session):
    name = _unique("Transfer")
    cat = _seed_category(db_session, user_id, name=name, category_type="expense")
    created = None
    try:
        result = create_category(
            CategoryCreate(name=name, category_type="income", color="#fff", icon="x"),
            db=db_session,
        )
        created = result
        assert result.name == name
        assert result.category_type == "income"
    finally:
        ids = [cat.id] + ([created.id] if created else [])
        _cleanup(category_ids=ids)


def test_update_category_rejects_structural_change_on_system_category(user_id, db_session):
    cat = _seed_category(db_session, user_id, name=_unique("Internal Transfer"), is_system=True)
    try:
        with pytest.raises(HTTPException) as exc_info:
            update_category(cat.id, CategoryUpdate(name="Renamed"), db=db_session)
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(category_ids=[cat.id])


def test_update_category_allows_description_on_system_category(user_id, db_session):
    cat = _seed_category(db_session, user_id, name=_unique("Internal Transfer"), is_system=True)
    try:
        result = update_category(
            cat.id, CategoryUpdate(description="Moved between my accounts"), db=db_session
        )
        assert result.description == "Moved between my accounts"
        assert result.name == cat.name
    finally:
        _cleanup(category_ids=[cat.id])


def test_update_category_rejects_duplicate_name_on_rename(user_id, db_session):
    groceries_name = _unique("Groceries")
    cat_groceries = _seed_category(
        db_session, user_id, name=groceries_name, category_type="expense"
    )
    other = _seed_category(db_session, user_id, name=_unique("Dining"), category_type="expense")
    try:
        with pytest.raises(HTTPException) as exc_info:
            update_category(other.id, CategoryUpdate(name=groceries_name), db=db_session)
        assert exc_info.value.status_code == 409
    finally:
        _cleanup(category_ids=[cat_groceries.id, other.id])


def test_delete_category_rejects_system_category(user_id, db_session):
    cat = _seed_category(db_session, user_id, name=_unique("Internal Transfer"), is_system=True)
    try:
        with pytest.raises(HTTPException) as exc_info:
            delete_category(cat.id, db=db_session)
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(category_ids=[cat.id])


def test_delete_category_reassigns_transactions(user_id, db_session):
    from decimal import Decimal
    from datetime import datetime

    old_cat = _seed_category(db_session, user_id, name=_unique("Old"))
    new_cat = _seed_category(db_session, user_id, name=_unique("New"))

    account = Account(user_id=user_id, name=_unique("Test Account"), account_type="checking")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    txn = Transaction(
        user_id=user_id,
        account_id=account.id,
        transaction_type="debit",
        amount=Decimal("10.00"),
        currency="EUR",
        description="test",
        booked_at=datetime.utcnow(),
        category_id=old_cat.id,
        category_system_id=old_cat.id,
    )
    db_session.add(txn)
    db_session.commit()

    try:
        result = delete_category(
            old_cat.id,
            payload=CategoryDeleteRequest(reassign_to_category_id=new_cat.id),
            db=db_session,
        )
        assert result.reassigned_count == 1

        db_session.refresh(txn)
        assert txn.category_id == new_cat.id
        assert txn.category_system_id == new_cat.id
    finally:
        _cleanup(category_ids=[old_cat.id, new_cat.id], account_ids=[account.id])


def test_create_category_accepts_a_group_parent(user_id, db_session):
    group = _seed_category(db_session, user_id, name=_unique("Needs"), hide_from_selection=True)
    created = None
    try:
        created = create_category(
            CategoryCreate(
                name=_unique("Groceries"),
                category_type="expense",
                color="#fff",
                icon="x",
                parent_id=group.id,
            ),
            db=db_session,
        )
        assert created.parent_id == group.id
    finally:
        ids = [group.id] + ([created.id] if created else [])
        _cleanup(category_ids=ids)


def test_create_category_rejects_parent_of_a_different_type(user_id, db_session):
    group = _seed_category(db_session, user_id, name=_unique("Income"), category_type="income")
    try:
        with pytest.raises(HTTPException) as exc_info:
            create_category(
                CategoryCreate(
                    name=_unique("Groceries"),
                    category_type="expense",
                    color="#fff",
                    icon="x",
                    parent_id=group.id,
                ),
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(category_ids=[group.id])


def test_create_category_rejects_nested_groups(user_id, db_session):
    group = _seed_category(db_session, user_id, name=_unique("Needs"))
    child = _seed_category(db_session, user_id, name=_unique("Groceries"), parent_id=group.id)
    try:
        with pytest.raises(HTTPException) as exc_info:
            create_category(
                CategoryCreate(
                    name=_unique("Supermarket"),
                    category_type="expense",
                    color="#fff",
                    icon="x",
                    parent_id=child.id,
                ),
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(category_ids=[child.id, group.id])


def test_create_category_allows_same_name_in_two_groups(user_id, db_session):
    name = _unique("Subscriptions")
    needs = _seed_category(db_session, user_id, name=_unique("Needs"))
    wants = _seed_category(db_session, user_id, name=_unique("Wants"))
    first = second = None
    try:
        first = create_category(
            CategoryCreate(
                name=name,
                category_type="expense",
                color="#fff",
                icon="x",
                parent_id=needs.id,
            ),
            db=db_session,
        )
        second = create_category(
            CategoryCreate(
                name=name,
                category_type="expense",
                color="#fff",
                icon="x",
                parent_id=wants.id,
            ),
            db=db_session,
        )
        assert first.parent_id == needs.id
        assert second.parent_id == wants.id
    finally:
        ids = [needs.id, wants.id]
        ids += [c.id for c in (first, second) if c]
        _cleanup(category_ids=ids)


def test_update_category_moves_a_category_between_groups(user_id, db_session):
    needs = _seed_category(db_session, user_id, name=_unique("Needs"))
    wants = _seed_category(db_session, user_id, name=_unique("Wants"))
    child = _seed_category(db_session, user_id, name=_unique("Gym"), parent_id=needs.id)
    try:
        result = update_category(child.id, CategoryUpdate(parent_id=wants.id), db=db_session)
        assert result.parent_id == wants.id
    finally:
        _cleanup(category_ids=[child.id, needs.id, wants.id])


def test_update_category_rejects_moving_a_group_into_another_group(user_id, db_session):
    group = _seed_category(db_session, user_id, name=_unique("Needs"))
    other = _seed_category(db_session, user_id, name=_unique("Wants"))
    child = _seed_category(db_session, user_id, name=_unique("Gym"), parent_id=group.id)
    try:
        with pytest.raises(HTTPException) as exc_info:
            update_category(group.id, CategoryUpdate(parent_id=other.id), db=db_session)
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(category_ids=[child.id, group.id, other.id])


def test_delete_group_leaves_its_categories_ungrouped(user_id, db_session):
    group = _seed_category(db_session, user_id, name=_unique("Needs"))
    child = _seed_category(db_session, user_id, name=_unique("Groceries"), parent_id=group.id)
    try:
        result = delete_category(group.id, db=db_session)
        assert result.ungrouped_count == 1

        db_session.refresh(child)
        assert child.parent_id is None
    finally:
        _cleanup(category_ids=[child.id])


def test_ensure_system_categories_parents_seeds_to_their_group(user_id, db_session):
    from app.services.system_categories import SystemCategorySeed, ensure_system_categories

    group_key = _unique("group_test")
    child_key = _unique("child_test")
    seeds = [
        SystemCategorySeed(
            key=group_key,
            name=_unique("Savings Group"),
            category_type="transfer",
            color="#047857",
            icon="RiSafe2Line",
            hide_from_selection=True,
        ),
        SystemCategorySeed(
            key=child_key,
            name=_unique("Savings Transfer"),
            category_type="transfer",
            color="#047857",
            icon="RiSafe2Line",
            group_key=group_key,
        ),
    ]

    inserted = ensure_system_categories(db_session, user_id, seeds)
    db_session.commit()
    ids = [category.id for category in inserted]
    try:
        assert len(inserted) == 2
        group = next(c for c in inserted if c.system_key == group_key)
        child = next(c for c in inserted if c.system_key == child_key)
        assert group.parent_id is None
        assert child.parent_id == group.id

        # Idempotent: a second call inserts nothing and leaves parents intact.
        assert ensure_system_categories(db_session, user_id, seeds) == []
        db_session.refresh(child)
        assert child.parent_id == group.id
    finally:
        _cleanup(category_ids=ids)


def test_ensure_system_categories_adopts_an_existing_ungrouped_category(user_id, db_session):
    from app.services.system_categories import SystemCategorySeed, ensure_system_categories

    group_key = _unique("group_test")
    child_key = _unique("child_test")
    child = _seed_category(
        db_session,
        user_id,
        name=_unique("Savings Transfer"),
        category_type="transfer",
        is_system=True,
        system_key=child_key,
    )
    seeds = [
        SystemCategorySeed(
            key=group_key,
            name=_unique("Savings Group"),
            category_type="transfer",
            color="#047857",
            icon="RiSafe2Line",
            hide_from_selection=True,
        ),
        SystemCategorySeed(
            key=child_key,
            name=child.name,
            category_type="transfer",
            color="#047857",
            icon="RiSafe2Line",
            group_key=group_key,
        ),
    ]

    inserted = ensure_system_categories(db_session, user_id, seeds)
    db_session.commit()
    ids = [child.id] + [category.id for category in inserted]
    try:
        # Only the group is new; the pre-existing category is moved into it.
        assert [category.system_key for category in inserted] == [group_key]
        db_session.refresh(child)
        assert child.parent_id == inserted[0].id
    finally:
        _cleanup(category_ids=ids)
