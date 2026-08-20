"""
Tests for GET /api/transactions/page (backend/app/routes/transactions.py::get_transaction_page),
the new paginated/filtered list endpoint backing transaction-list.repository.ts's migration off
Drizzle. Mirrors the pre-migration buildWhereClause combinators: multi-value account/category/
subscription filters, category and subscription each pairing with an "uncategorized"/
"no_subscription" sentinel, and horizon-based date resolution anchored to the latest transaction
in scope.

Every test passes account_ids scoped to its own seeded account(s) — the fixture user is a shared
system user (see user_id fixture), so an unscoped query would also match leftover data from every
other test file that has ever run against this dev DB.

Run with:
    cd backend && pytest tests/test_transaction_page.py -v
"""

import os
import sys
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from app.database import SessionLocal, Base, engine
from app.models import Account, Category, Transaction
from app.db_helpers import get_or_create_system_user
from app.routes.transactions import get_transaction_page


def _call_page(user_id, db, **overrides):
    """Calls get_transaction_page directly (bypassing HTTP/Depends). FastAPI's
    `Query(...)` marker objects are only resolved to their default when a
    real request goes through routing, so every Query-typed param needs an
    explicit value here rather than relying on the function's own defaults."""
    params = dict(
        account_ids=None,
        category=None,
        status=None,
        subscription=None,
        analytics=None,
        min_amount=None,
        max_amount=None,
        search=None,
        from_date=None,
        to_date=None,
        horizon=None,
        sort=None,
        order="desc",
        page=1,
        page_size=50,
        include_filtered_totals=False,
    )
    params.update(overrides)
    return get_transaction_page(user_id=user_id, db=db, **params)


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


def _seed_category(db, user_id: str, **overrides) -> str:
    defaults = dict(user_id=user_id, name=_unique("Category"), category_type="expense")
    defaults.update(overrides)
    category = Category(**defaults)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category.id


def _seed_transaction(db, user_id: str, account_id, amount, booked_at, **overrides) -> str:
    defaults = dict(
        user_id=user_id,
        account_id=account_id,
        transaction_type="debit" if Decimal(str(amount)) < 0 else "credit",
        amount=amount,
        currency="EUR",
        description="test txn",
        booked_at=booked_at,
    )
    defaults.update(overrides)
    txn = Transaction(**defaults)
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn.id


def _cleanup(*, account_ids=(), category_ids=()):
    db = SessionLocal()
    try:
        if account_ids:
            db.query(Transaction).filter(Transaction.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Account).filter(Account.id.in_(account_ids)).delete(synchronize_session=False)
        if category_ids:
            db.query(Category).filter(Category.id.in_(category_ids)).delete(
                synchronize_session=False
            )
        db.commit()
    finally:
        db.close()


def test_account_ids_filter_scopes_to_selected_accounts(user_id):
    db = SessionLocal()
    a = _seed_account(db, user_id)
    b = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    _seed_transaction(db, user_id, a, "-10.00", base)
    _seed_transaction(db, user_id, b, "-20.00", base)
    try:
        result = _call_page(account_ids=[a], user_id=user_id, db=db)
        assert result.total_count == 1
        assert result.rows[0].account_id == a
    finally:
        db.close()
        _cleanup(account_ids=[a, b])


def test_category_filter_combines_ids_and_uncategorized(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    other_category = _seed_category(db, user_id)
    base = datetime(2024, 1, 1)
    categorized = _seed_transaction(db, user_id, account, "-5.00", base, category_id=category)
    uncategorized = _seed_transaction(db, user_id, account, "-6.00", base)
    _seed_transaction(db, user_id, account, "-7.00", base, category_id=other_category)
    try:
        result = _call_page(
            account_ids=[account],
            category=[str(category), "uncategorized"],
            user_id=user_id,
            db=db,
        )
        ids = {row.id for row in result.rows}
        assert ids == {categorized, uncategorized}
        assert result.total_count == 2
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category, other_category])


def test_status_filter_pending_only(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    pending_txn = _seed_transaction(db, user_id, account, "-1.00", base, pending=True)
    _seed_transaction(db, user_id, account, "-2.00", base, pending=False)
    try:
        result = _call_page(account_ids=[account], status=["pending"], user_id=user_id, db=db)
        assert [row.id for row in result.rows] == [pending_txn]
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_analytics_filter_excluded(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    excluded_txn = _seed_transaction(
        db, user_id, account, "-1.00", base, include_in_analytics=False
    )
    _seed_transaction(db, user_id, account, "-2.00", base, include_in_analytics=True)
    try:
        result = _call_page(account_ids=[account], analytics=["excluded"], user_id=user_id, db=db)
        assert [row.id for row in result.rows] == [excluded_txn]
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_min_max_amount_filters_by_absolute_value(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    small = _seed_transaction(db, user_id, account, "-5.00", base)
    _seed_transaction(db, user_id, account, "-50.00", base)
    try:
        result = _call_page(
            account_ids=[account], min_amount=1, max_amount=10, user_id=user_id, db=db
        )
        assert [row.id for row in result.rows] == [small]
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_horizon_resolves_window_anchored_to_latest_transaction(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    latest = datetime(2024, 6, 10)
    in_window = _seed_transaction(db, user_id, account, "-1.00", latest - timedelta(days=2))
    _seed_transaction(db, user_id, account, "-2.00", latest - timedelta(days=10))
    _seed_transaction(db, user_id, account, "-3.00", latest)
    try:
        result = _call_page(account_ids=[account], horizon=5, user_id=user_id, db=db)
        assert result.effective_horizon == 5
        assert result.resolved_to == "2024-06-10"
        assert result.resolved_from == "2024-06-06"
        ids = {row.id for row in result.rows}
        assert in_window in ids
        assert result.total_count == 2
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_filtered_totals_only_computed_when_requested(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    _seed_transaction(db, user_id, account, "100.00", base, transaction_type="credit")
    _seed_transaction(db, user_id, account, "-40.00", base, transaction_type="debit")
    try:
        without = _call_page(account_ids=[account], user_id=user_id, db=db)
        assert without.filtered_totals is None

        with_totals = _call_page(
            account_ids=[account],
            include_filtered_totals=True,
            user_id=user_id,
            db=db,
        )
        assert with_totals.filtered_totals is not None
        assert with_totals.filtered_totals.total_in == pytest.approx(100.00)
        assert with_totals.filtered_totals.total_out == pytest.approx(40.00)
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_pagination_and_amount_sort(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    base = datetime(2024, 1, 1)
    small = _seed_transaction(db, user_id, account, "-5.00", base)
    large = _seed_transaction(db, user_id, account, "-50.00", base)
    try:
        page1 = _call_page(
            account_ids=[account],
            sort="amount",
            order="asc",
            page=1,
            page_size=1,
            user_id=user_id,
            db=db,
        )
        assert page1.total_count == 2
        assert page1.rows[0].id == large  # -50 sorts before -5 ascending

        page2 = _call_page(
            account_ids=[account],
            sort="amount",
            order="asc",
            page=2,
            page_size=1,
            user_id=user_id,
            db=db,
        )
        assert page2.rows[0].id == small
    finally:
        db.close()
        _cleanup(account_ids=[account])
