"""
Tests for GET /api/transactions/stats/category-spending and
/stats/category-spending/transactions (backend/app/routes/transactions.py),
backing lib/actions/category-spending.ts's migration off Drizzle: the
linked-group net-amount special case, uncategorized bucket, period-over-period
deltas, default-to-current-month range resolution, and the transactions-page
category combinator.

Run with:
    cd backend && pytest tests/test_category_spending.py -v
"""

import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from app.database import SessionLocal, Base, engine
from app.models import Account, Category, Transaction, TransactionLink
from app.db_helpers import get_or_create_system_user
from app.routes.transactions import (
    get_category_spending_data,
    get_category_spending_transactions_page,
)


def _call_spending(user_id, db, **overrides):
    params = dict(account_ids=None, from_date=None, to_date=None, horizon=None)
    params.update(overrides)
    return get_category_spending_data(user_id=user_id, db=db, **params)


def _call_spending_page(user_id, db, **overrides):
    params = dict(
        account_ids=None,
        category=None,
        from_date=None,
        to_date=None,
        horizon=None,
        sort=None,
        order="desc",
        page=1,
        page_size=20,
    )
    params.update(overrides)
    return get_category_spending_transactions_page(user_id=user_id, db=db, **params)


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
        include_in_analytics=True,
    )
    defaults.update(overrides)
    txn = Transaction(**defaults)
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn.id


def _link(db, user_id: str, group_id, transaction_id, role: str) -> None:
    db.add(
        TransactionLink(
            user_id=user_id, group_id=group_id, transaction_id=transaction_id, link_role=role
        )
    )
    db.commit()


def _cleanup(*, account_ids=(), category_ids=()):
    db = SessionLocal()
    try:
        if account_ids:
            db.query(TransactionLink).filter(
                TransactionLink.transaction_id.in_(
                    db.query(Transaction.id).filter(Transaction.account_id.in_(account_ids))
                )
            ).delete(synchronize_session=False)
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


def test_categorized_and_uncategorized_buckets(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    base = datetime(2024, 3, 10)
    _seed_transaction(db, user_id, account, "-40.00", base, category_id=category)
    _seed_transaction(db, user_id, account, "-10.00", base)
    try:
        result = _call_spending(
            user_id, db, account_ids=[account], from_date="2024-03-01", to_date="2024-03-31"
        )
        by_id = {c.id: c for c in result.categories}
        assert by_id[str(category)].amount == pytest.approx(40.00)
        assert by_id["uncategorized"].amount == pytest.approx(10.00)
        assert result.summary.total_spend == pytest.approx(50.00)
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category])


def test_linked_group_counts_net_amount_on_primary_only(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    base = datetime(2024, 3, 10)
    expense = _seed_transaction(db, user_id, account, "-100.00", base, category_id=category)
    reimbursement = _seed_transaction(db, user_id, account, "30.00", base)
    group_id = uuid.uuid4()
    _link(db, user_id, group_id, expense, "primary")
    _link(db, user_id, group_id, reimbursement, "reimbursement")
    try:
        result = _call_spending(
            user_id, db, account_ids=[account], from_date="2024-03-01", to_date="2024-03-31"
        )
        by_id = {c.id: c for c in result.categories}
        # Net amount: -100 + 30 = -70 -> 70 counted (not the raw 100).
        assert by_id[str(category)].amount == pytest.approx(70.00)
        # The reimbursement leg itself must not also appear as its own uncategorized spend.
        assert "uncategorized" not in by_id
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category])


def test_fully_reimbursed_expense_drops_out(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    base = datetime(2024, 3, 10)
    expense = _seed_transaction(db, user_id, account, "-100.00", base, category_id=category)
    reimbursement = _seed_transaction(db, user_id, account, "100.00", base)
    group_id = uuid.uuid4()
    _link(db, user_id, group_id, expense, "primary")
    _link(db, user_id, group_id, reimbursement, "reimbursement")
    try:
        result = _call_spending(
            user_id, db, account_ids=[account], from_date="2024-03-01", to_date="2024-03-31"
        )
        # The category row still appears (grouped by category, unconditionally,
        # matching the pre-migration behavior) but nets to zero.
        assert [c.amount for c in result.categories] == [0]
        assert result.summary.total_spend == pytest.approx(0)
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category])


def test_period_over_period_delta(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    _seed_transaction(db, user_id, account, "-50.00", datetime(2024, 3, 10), category_id=category)
    _seed_transaction(db, user_id, account, "-20.00", datetime(2024, 2, 10), category_id=category)
    try:
        result = _call_spending(
            user_id, db, account_ids=[account], from_date="2024-03-01", to_date="2024-03-31"
        )
        current = next(c for c in result.categories if c.id == str(category))
        assert current.amount == pytest.approx(50.00)
        assert current.delta_amount == pytest.approx(30.00)
        assert current.delta_pct == pytest.approx(150.00)
        assert result.range.comparison_start_date == "2024-01-30"
        assert result.range.comparison_end_date == "2024-02-29"
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category])


def test_default_range_is_current_month_of_latest_transaction(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    _seed_transaction(db, user_id, account, "-15.00", datetime(2024, 6, 15))
    try:
        result = _call_spending(user_id, db, account_ids=[account])
        assert result.range.start_date == "2024-06-01"
        assert result.range.end_date == "2024-06-30"
        assert result.range.month_count == 1
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_horizon_resolves_trailing_window(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    latest = datetime(2024, 6, 10)
    _seed_transaction(db, user_id, account, "-15.00", latest)
    try:
        result = _call_spending(user_id, db, account_ids=[account], horizon=5)
        assert result.range.start_date == "2024-06-06"
        assert result.range.end_date == "2024-06-10"
    finally:
        db.close()
        _cleanup(account_ids=[account])


def test_transactions_page_filters_to_selected_category_and_uncategorized(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    category = _seed_category(db, user_id)
    other_category = _seed_category(db, user_id)
    base = datetime(2024, 3, 10)
    matching = _seed_transaction(db, user_id, account, "-40.00", base, category_id=category)
    uncategorized = _seed_transaction(db, user_id, account, "-10.00", base)
    _seed_transaction(db, user_id, account, "-5.00", base, category_id=other_category)
    try:
        result = _call_spending_page(
            user_id,
            db,
            account_ids=[account],
            category=[str(category), "uncategorized"],
            from_date="2024-03-01",
            to_date="2024-03-31",
        )
        ids = {row.id for row in result.rows}
        assert ids == {matching, uncategorized}
        assert result.total_count == 2
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[category, other_category])


def test_transactions_page_excludes_non_expense_category_by_default(user_id):
    db = SessionLocal()
    account = _seed_account(db, user_id)
    transfer_category = _seed_category(db, user_id, category_type="transfer")
    base = datetime(2024, 3, 10)
    _seed_transaction(db, user_id, account, "-40.00", base, category_id=transfer_category)
    try:
        result = _call_spending_page(
            user_id, db, account_ids=[account], from_date="2024-03-01", to_date="2024-03-31"
        )
        assert result.rows == []
        assert result.total_count == 0
    finally:
        db.close()
        _cleanup(account_ids=[account], category_ids=[transfer_category])
