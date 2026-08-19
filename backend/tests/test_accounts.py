"""
Tests for the accounts routes' Phase 2 additions (backend/app/routes/accounts.py):
- recalculate-balances-from-date boundary logic
- logo null-guard endpoint
- update_account field coverage

Exercises the route functions directly against the database (no HTTP), mirroring
the setup style used in test_categories.py. Routes here use
`Depends(get_user_id)`, so tests pass `user_id=` explicitly rather than going
through the auth contextvar.

Run with:
    cd backend && pytest tests/test_accounts.py -v
"""

import os
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import HTTPException

from app.database import SessionLocal, Base, engine
from app.models import (
    Account,
    AccountBalance,
    Category,
    CompanyLogo,
    RecurringTransaction,
    SubscriptionSuggestion,
    Transaction,
    User,
)
from app.db_helpers import get_or_create_system_user, set_request_user_id, clear_request_user_id
from app.routes.accounts import (
    create_account,
    get_account_logo,
    hard_delete_account,
    recalculate_balances_from_date,
    set_account_logo_if_missing,
    update_account,
)
from app.schemas import (
    AccountCreate,
    AccountLogoSetRequest,
    AccountUpdate,
    RecalculateBalancesFromDateRequest,
)


@pytest.fixture
def user_id():
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=engine)
        user = get_or_create_system_user(db)
        uid = str(user.id)
    finally:
        db.close()

    # update_account still uses the legacy Optional[str]-param auth pattern
    # (get_user_id(user_id) internally, not Depends(get_user_id)), which falls
    # back to this contextvar — same as test_categories.py's fixture.
    token = set_request_user_id(uid)
    try:
        yield uid
    finally:
        clear_request_user_id(token)


def _unique(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def _seed_account(db, user_id: str, **overrides) -> Account:
    defaults = dict(
        user_id=user_id,
        name=_unique("Account"),
        account_type="checking",
        currency="EUR",
        provider="manual",
        is_active=True,
    )
    defaults.update(overrides)
    account = Account(**defaults)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def _seed_transaction(db, user_id: str, account_id, amount, booked_at, **overrides) -> Transaction:
    defaults = dict(
        user_id=user_id,
        account_id=account_id,
        transaction_type="debit" if float(amount) < 0 else "credit",
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
    return txn


def _cleanup(*, account_ids=(), category_ids=(), logo_ids=()):
    db = SessionLocal()
    try:
        if account_ids:
            db.query(AccountBalance).filter(AccountBalance.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Transaction).filter(Transaction.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Account).filter(Account.id.in_(account_ids)).delete(synchronize_session=False)
        if category_ids:
            db.query(Category).filter(Category.id.in_(category_ids)).delete(
                synchronize_session=False
            )
        if logo_ids:
            db.query(CompanyLogo).filter(CompanyLogo.id.in_(logo_ids)).delete(
                synchronize_session=False
            )
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# recalculate-balances-from-date
# ---------------------------------------------------------------------------


def test_recalculate_balances_stops_before_next_balancing_transfer(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance="0")
    balancing_category = Category(
        user_id=user_id, name="Balancing Transfer", category_type="transfer", is_system=True
    )
    db_session.add(balancing_category)
    db_session.commit()
    db_session.refresh(balancing_category)

    base = datetime(2024, 1, 1)
    _seed_transaction(db_session, user_id, account.id, "100.00", base)
    _seed_transaction(db_session, user_id, account.id, "50.00", base + timedelta(days=2))
    balancing_txn = _seed_transaction(
        db_session,
        user_id,
        account.id,
        "0.00",
        base + timedelta(days=5),
        category_id=balancing_category.id,
    )

    try:
        recalculate_balances_from_date(
            account.id,
            RecalculateBalancesFromDateRequest(from_date=base, starting_balance="0"),
            user_id=user_id,
            db=db_session,
        )
        rows = {
            row.date: row
            for row in db_session.query(AccountBalance)
            .filter(AccountBalance.account_id == account.id)
            .all()
        }
        # Stops the day BEFORE the balancing transfer (day 5) -> last row is day 4.
        assert base + timedelta(days=4) in rows
        assert base + timedelta(days=5) not in rows
        # Day 3 (after the +100/+50 but before anything else) reflects both.
        assert rows[base + timedelta(days=3)].balance_in_account_currency == pytest.approx(150.00)
    finally:
        _cleanup(account_ids=[account.id], category_ids=[balancing_category.id])


def test_recalculate_balances_stops_at_most_recent_existing_balance(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance="0")
    base = datetime(2024, 2, 1)
    _seed_transaction(db_session, user_id, account.id, "10.00", base)

    existing = AccountBalance(
        account_id=account.id,
        date=base + timedelta(days=3),
        balance_in_account_currency="10.00",
        balance_in_functional_currency="10.00",
    )
    db_session.add(existing)
    db_session.commit()

    try:
        recalculate_balances_from_date(
            account.id,
            RecalculateBalancesFromDateRequest(from_date=base, starting_balance="0"),
            user_id=user_id,
            db=db_session,
        )
        rows = {
            row.date: row
            for row in db_session.query(AccountBalance)
            .filter(AccountBalance.account_id == account.id)
            .all()
        }
        assert base + timedelta(days=3) in rows
        assert base + timedelta(days=4) not in rows
    finally:
        _cleanup(account_ids=[account.id])


def test_recalculate_balances_excludes_given_transaction(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance="0")
    base = datetime(2024, 3, 1)
    _seed_transaction(db_session, user_id, account.id, "100.00", base)
    to_delete = _seed_transaction(db_session, user_id, account.id, "-40.00", base)

    try:
        recalculate_balances_from_date(
            account.id,
            RecalculateBalancesFromDateRequest(
                from_date=base, starting_balance="0", exclude_transaction_id=to_delete.id
            ),
            user_id=user_id,
            db=db_session,
        )
        row = (
            db_session.query(AccountBalance)
            .filter(AccountBalance.account_id == account.id, AccountBalance.date == base)
            .one()
        )
        assert row.balance_in_account_currency == pytest.approx(100.00)
    finally:
        _cleanup(account_ids=[account.id])


# ---------------------------------------------------------------------------
# logo null-guard endpoint
# ---------------------------------------------------------------------------


def test_set_account_logo_applies_when_missing(user_id, db_session):
    account = _seed_account(db_session, user_id, institution="Acme Bank")
    logo = CompanyLogo(domain="acme.test", company_name="Acme", logo_url="/l/acme.png")
    db_session.add(logo)
    db_session.commit()
    db_session.refresh(logo)

    try:
        result = set_account_logo_if_missing(
            account.id, AccountLogoSetRequest(logo_id=logo.id), user_id=user_id, db=db_session
        )
        assert result.applied is True
        assert result.logo_id == logo.id
        assert result.logo.logo_url == "/l/acme.png"

        fetched = get_account_logo(account.id, user_id=user_id, db=db_session)
        assert fetched.logo_id == logo.id
    finally:
        _cleanup(account_ids=[account.id], logo_ids=[logo.id])


def test_set_account_logo_does_not_overwrite_existing(user_id, db_session):
    first_logo = CompanyLogo(domain="first.test", company_name="First", logo_url="/l/first.png")
    second_logo = CompanyLogo(domain="second.test", company_name="Second", logo_url="/l/second.png")
    db_session.add_all([first_logo, second_logo])
    db_session.commit()
    db_session.refresh(first_logo)
    db_session.refresh(second_logo)

    account = _seed_account(db_session, user_id, institution="Acme Bank", logo_id=first_logo.id)

    try:
        result = set_account_logo_if_missing(
            account.id,
            AccountLogoSetRequest(logo_id=second_logo.id),
            user_id=user_id,
            db=db_session,
        )
        assert result.applied is False
        assert result.logo_id == first_logo.id
    finally:
        _cleanup(account_ids=[account.id], logo_ids=[first_logo.id, second_logo.id])


def test_set_account_logo_returns_404_for_other_user(user_id, db_session):
    other_user = User(
        id=_unique("other-user"), email=f"{uuid.uuid4().hex}@example.com", email_verified=True
    )
    db_session.add(other_user)
    db_session.commit()

    account = _seed_account(db_session, user_id)
    logo = CompanyLogo(domain=_unique("d") + ".test", company_name="X")
    db_session.add(logo)
    db_session.commit()
    db_session.refresh(logo)

    try:
        with pytest.raises(HTTPException) as exc_info:
            set_account_logo_if_missing(
                account.id,
                AccountLogoSetRequest(logo_id=logo.id),
                user_id=other_user.id,
                db=db_session,
            )
        assert exc_info.value.status_code == 404
    finally:
        _cleanup(account_ids=[account.id], logo_ids=[logo.id])
        db2 = SessionLocal()
        try:
            db2.query(User).filter(User.id == other_user.id).delete()
            db2.commit()
        finally:
            db2.close()


# ---------------------------------------------------------------------------
# update_account field coverage
# ---------------------------------------------------------------------------


def test_update_account_updates_all_fields(user_id, db_session):
    account = _seed_account(
        db_session,
        user_id,
        name="Old Name",
        account_type="checking",
        currency="EUR",
        starting_balance="0",
    )
    logo = CompanyLogo(domain=_unique("d") + ".test", company_name="X")
    db_session.add(logo)
    db_session.commit()
    db_session.refresh(logo)

    try:
        result = update_account(
            account.id,
            AccountUpdate(
                name="New Name",
                account_type="savings",
                currency="USD",
                starting_balance="250.50",
                logo_id=logo.id,
                is_active=False,
            ),
            user_id=user_id,
            db=db_session,
        )
        assert result.name == "New Name"
        assert result.account_type == "savings"
        assert result.currency == "USD"
        assert result.starting_balance == pytest.approx(250.50)
        assert result.logo_id == logo.id
        assert result.is_active is False
    finally:
        _cleanup(account_ids=[account.id], logo_ids=[logo.id])


def test_update_account_partial_update_leaves_other_fields(user_id, db_session):
    account = _seed_account(db_session, user_id, name="Keep Me", account_type="checking")
    try:
        result = update_account(
            account.id, AccountUpdate(currency="GBP"), user_id=user_id, db=db_session
        )
        assert result.name == "Keep Me"
        assert result.account_type == "checking"
        assert result.currency == "GBP"
    finally:
        _cleanup(account_ids=[account.id])


# ---------------------------------------------------------------------------
# create_account: manual-account functional_balance mirroring
# ---------------------------------------------------------------------------


def test_create_account_mirrors_starting_balance_into_functional_balance(user_id, db_session):
    result = create_account(
        AccountCreate(
            name=_unique("Manual"),
            account_type="checking",
            currency="EUR",
            provider="manual",
            starting_balance="500.00",
        ),
        user_id=user_id,
        db=db_session,
    )
    try:
        assert result.provider == "manual"
        assert result.starting_balance == pytest.approx(500.00)
        assert result.functional_balance == pytest.approx(500.00)
    finally:
        _cleanup(account_ids=[result.id])


# ---------------------------------------------------------------------------
# hard_delete_account
# ---------------------------------------------------------------------------


def test_hard_delete_account_removes_recurring_and_subscription_rows(user_id, db_session):
    account = _seed_account(db_session, user_id)
    _seed_transaction(db_session, user_id, account.id, "10.00", datetime(2024, 1, 1))

    balance = AccountBalance(
        account_id=account.id,
        date=datetime(2024, 1, 1),
        balance_in_account_currency="10.00",
        balance_in_functional_currency="10.00",
    )
    recurring = RecurringTransaction(
        user_id=user_id,
        account_id=account.id,
        name="Netflix",
        amount="9.99",
        frequency="monthly",
    )
    suggestion = SubscriptionSuggestion(
        user_id=user_id,
        account_id=account.id,
        suggested_name="Spotify",
        suggested_amount="9.99",
        detected_frequency="monthly",
        confidence=80,
        matched_transaction_ids="[]",
    )
    db_session.add_all([balance, recurring, suggestion])
    db_session.commit()
    recurring_id, suggestion_id = recurring.id, suggestion.id

    result = hard_delete_account(account.id, user_id=user_id, db=db_session)

    assert result.deleted_balances == 1
    assert result.deleted_transactions == 1
    assert db_session.query(Account).filter(Account.id == account.id).count() == 0
    assert (
        db_session.query(RecurringTransaction)
        .filter(RecurringTransaction.id == recurring_id)
        .count()
        == 0
    )
    assert (
        db_session.query(SubscriptionSuggestion)
        .filter(SubscriptionSuggestion.id == suggestion_id)
        .count()
        == 0
    )


def test_hard_delete_account_returns_404_for_other_user(user_id, db_session):
    other_user = User(
        id=_unique("other-user"), email=f"{uuid.uuid4().hex}@example.com", email_verified=True
    )
    db_session.add(other_user)
    db_session.commit()

    account = _seed_account(db_session, user_id)
    try:
        with pytest.raises(HTTPException) as exc_info:
            hard_delete_account(account.id, user_id=other_user.id, db=db_session)
        assert exc_info.value.status_code == 404
    finally:
        _cleanup(account_ids=[account.id])
        db2 = SessionLocal()
        try:
            db2.query(User).filter(User.id == other_user.id).delete()
            db2.commit()
        finally:
            db2.close()
