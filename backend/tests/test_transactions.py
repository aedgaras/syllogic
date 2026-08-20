"""
Tests for the transactions routes' Phase 2 additions (backend/app/routes/transactions.py
and backend/app/services/transaction_mutation_service.py):
- transfer creation
- convert-to-transfer guards
- interest guard
- update invariants
- balancing upsert
- delete-impact + bulk-delete

Exercises the route functions directly against the database (no HTTP), mirroring
the setup style used in test_accounts.py. Routes here use `Depends(get_user_id)`,
so tests pass `user_id=` explicitly rather than going through the auth contextvar,
except update_transaction, which still uses the legacy Optional[str]-param
pattern and relies on the request_user_id contextvar (see fixture below).

Run with:
    cd backend && pytest tests/test_transactions.py -v
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
from app.models import Account, AccountBalance, Category, Holding, InternalTransfer, Transaction
from app.db_helpers import get_or_create_system_user, set_request_user_id, clear_request_user_id
from app.services.system_categories import (
    INTEREST_CATEGORY_SEEDS,
    TRANSFER_CATEGORY_SEEDS,
)
from app.routes.transactions import (
    add_interest_transaction,
    bulk_delete_transactions,
    convert_transaction_to_transfer,
    create_transfer_transaction,
    delete_balancing_transaction,
    get_accrued_interest,
    get_delete_impact,
    update_transaction,
    upsert_balancing_transaction,
)
from app.schemas import (
    BalancingTransactionUpsert,
    BulkDeleteRequest,
    DeleteImpactRequest,
    InterestTransactionCreate,
    TransactionConvertToTransferRequest,
    TransactionUpdate,
    TransferTransactionCreate,
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

    token = set_request_user_id(uid)
    try:
        yield uid
    finally:
        clear_request_user_id(token)


def _purge_leaked_system_categories() -> None:
    """create_transfer_transaction/add_interest_transaction idempotently
    bootstrap system categories (Balancing Transfer, Interest, ...) for the
    shared system user via ensure_system_categories. Individual tests don't
    own these rows so can't clean them up per-test; left alone they persist
    in the real dev DB and collide with other test files (e.g. test_accounts.py)
    that assume a clean slate when creating their own same-named category.
    """
    db = SessionLocal()
    try:
        uid = str(get_or_create_system_user(db).id)
        names = [seed.name for seed in TRANSFER_CATEGORY_SEEDS] + [
            seed.name for seed in INTEREST_CATEGORY_SEEDS
        ]
        db.query(Category).filter(Category.user_id == uid, Category.name.in_(names)).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def _clean_leaked_system_categories():
    _purge_leaked_system_categories()
    yield
    _purge_leaked_system_categories()


def _unique(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def _seed_account(db, user_id: str, **overrides) -> Account:
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
    return account


def _seed_transaction(db, user_id: str, account_id, amount, booked_at, **overrides) -> Transaction:
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
    return txn


def _cleanup(*, account_ids=(), category_ids=(), transaction_ids=()):
    db = SessionLocal()
    try:
        if account_ids:
            db.query(InternalTransfer).filter(
                InternalTransfer.source_account_id.in_(account_ids)
                | InternalTransfer.pocket_account_id.in_(account_ids)
            ).delete(synchronize_session=False)
            db.query(Holding).filter(Holding.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(AccountBalance).filter(AccountBalance.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Transaction).filter(Transaction.account_id.in_(account_ids)).delete(
                synchronize_session=False
            )
            db.query(Account).filter(Account.id.in_(account_ids)).delete(synchronize_session=False)
        if transaction_ids:
            db.query(Transaction).filter(Transaction.id.in_(transaction_ids)).delete(
                synchronize_session=False
            )
        if category_ids:
            db.query(Transaction).filter(Transaction.category_id.in_(category_ids)).update(
                {"category_id": None}, synchronize_session=False
            )
            db.query(Category).filter(Category.id.in_(category_ids)).delete(
                synchronize_session=False
            )
        db.commit()
    finally:
        db.close()


def _seed_balancing_category(db, user_id: str) -> Category:
    cat = Category(
        user_id=user_id,
        name="Balancing Transfer",
        category_type="transfer",
        is_system=True,
        system_key=_unique("balancing_transfer"),
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


# ---------------------------------------------------------------------------
# create_transfer_transaction
# ---------------------------------------------------------------------------


def test_create_transfer_creates_linked_legs_and_updates_balances(user_id, db_session):
    source = _seed_account(db_session, user_id, starting_balance=Decimal("100"))
    destination = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    try:
        result = create_transfer_transaction(
            TransferTransactionCreate(
                source_account_id=source.id,
                destination_account_id=destination.id,
                amount=Decimal("25.00"),
                description="Move to savings",
                booked_at=datetime(2024, 1, 10),
            ),
            user_id=user_id,
            db=db_session,
        )
        assert result.source_transaction_id
        assert result.destination_transaction_id

        transfer = (
            db_session.query(InternalTransfer)
            .filter(InternalTransfer.source_txn_id == result.source_transaction_id)
            .one()
        )
        assert transfer.mirror_txn_id == result.destination_transaction_id
        assert transfer.amount == pytest.approx(25.00)

        db_session.refresh(source)
        db_session.refresh(destination)
        assert source.functional_balance == pytest.approx(75.00)
        assert destination.functional_balance == pytest.approx(25.00)

        source_txn = db_session.query(Transaction).get(result.source_transaction_id)
        dest_txn = db_session.query(Transaction).get(result.destination_transaction_id)
        assert source_txn.internal_transfer_id == transfer.id
        assert dest_txn.internal_transfer_id == transfer.id
        assert source_txn.include_in_analytics is False
    finally:
        _cleanup(account_ids=[source.id, destination.id])


def test_create_transfer_rejects_same_account(user_id, db_session):
    account = _seed_account(db_session, user_id)
    try:
        with pytest.raises(HTTPException) as exc_info:
            create_transfer_transaction(
                TransferTransactionCreate(
                    source_account_id=account.id,
                    destination_account_id=account.id,
                    amount=Decimal("10.00"),
                    description="test",
                    booked_at=datetime(2024, 1, 1),
                ),
                user_id=user_id,
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[account.id])


def test_create_transfer_rejects_currency_mismatch(user_id, db_session):
    source = _seed_account(db_session, user_id, currency="EUR")
    destination = _seed_account(db_session, user_id, currency="USD")
    try:
        with pytest.raises(HTTPException) as exc_info:
            create_transfer_transaction(
                TransferTransactionCreate(
                    source_account_id=source.id,
                    destination_account_id=destination.id,
                    amount=Decimal("10.00"),
                    description="test",
                    booked_at=datetime(2024, 1, 1),
                ),
                user_id=user_id,
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[source.id, destination.id])


# ---------------------------------------------------------------------------
# convert_transaction_to_transfer
# ---------------------------------------------------------------------------


def test_convert_transaction_to_transfer_creates_destination_leg(user_id, db_session):
    source = _seed_account(db_session, user_id, starting_balance=Decimal("50"))
    destination = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    existing = _seed_transaction(
        db_session, user_id, source.id, "-30.00", datetime(2024, 2, 1), description="Rent"
    )
    try:
        result = convert_transaction_to_transfer(
            existing.id,
            TransactionConvertToTransferRequest(
                source_account_id=source.id,
                destination_account_id=destination.id,
                amount=Decimal("30.00"),
                description="Moved to pocket",
                booked_at=datetime(2024, 2, 1),
            ),
            user_id=user_id,
            db=db_session,
        )
        assert result.source_transaction_id == existing.id
        db_session.refresh(existing)
        assert existing.internal_transfer_id is not None
        assert existing.amount == pytest.approx(-30.00)

        dest_txn = db_session.query(Transaction).get(result.destination_transaction_id)
        assert dest_txn.account_id == destination.id
        assert dest_txn.amount == pytest.approx(30.00)
    finally:
        _cleanup(account_ids=[source.id, destination.id])


def test_convert_transaction_to_transfer_rejects_already_linked(user_id, db_session):
    source = _seed_account(db_session, user_id)
    destination = _seed_account(db_session, user_id)
    other = _seed_account(db_session, user_id)
    existing = _seed_transaction(db_session, user_id, source.id, "-10.00", datetime(2024, 1, 1))
    transfer = InternalTransfer(
        user_id=user_id,
        source_txn_id=existing.id,
        source_account_id=source.id,
        pocket_account_id=other.id,
        amount=Decimal("10.00"),
        currency="EUR",
    )
    db_session.add(transfer)
    db_session.commit()
    existing.internal_transfer_id = transfer.id
    db_session.commit()

    try:
        with pytest.raises(HTTPException) as exc_info:
            convert_transaction_to_transfer(
                existing.id,
                TransactionConvertToTransferRequest(
                    source_account_id=source.id,
                    destination_account_id=destination.id,
                    amount=Decimal("10.00"),
                    description="test",
                    booked_at=datetime(2024, 1, 1),
                ),
                user_id=user_id,
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[source.id, destination.id, other.id])


# ---------------------------------------------------------------------------
# add_interest_transaction
# ---------------------------------------------------------------------------


def test_add_interest_rejects_non_savings_account(user_id, db_session):
    account = _seed_account(db_session, user_id, account_type="checking")
    try:
        with pytest.raises(HTTPException) as exc_info:
            add_interest_transaction(
                InterestTransactionCreate(
                    account_id=account.id, amount=Decimal("5.00"), booked_at=datetime(2024, 1, 1)
                ),
                user_id=user_id,
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[account.id])


def test_add_interest_credits_savings_account_and_is_accrued(user_id, db_session):
    account = _seed_account(
        db_session, user_id, account_type="savings", starting_balance=Decimal("1000")
    )
    try:
        result = add_interest_transaction(
            InterestTransactionCreate(
                account_id=account.id, amount=Decimal("12.50"), booked_at=datetime(2024, 3, 1)
            ),
            user_id=user_id,
            db=db_session,
        )
        assert result.transaction_id

        db_session.refresh(account)
        assert account.functional_balance == pytest.approx(1012.50)

        accrued = get_accrued_interest(account.id, user_id=user_id, db=db_session)
        assert accrued.total == pytest.approx(12.50)
    finally:
        _cleanup(account_ids=[account.id])


# ---------------------------------------------------------------------------
# update_transaction
# ---------------------------------------------------------------------------


def test_update_transaction_rejects_when_internal_transfer_linked(user_id, db_session):
    account = _seed_account(db_session, user_id)
    other = _seed_account(db_session, user_id)
    txn = _seed_transaction(db_session, user_id, account.id, "-10.00", datetime(2024, 1, 1))
    transfer = InternalTransfer(
        user_id=user_id,
        source_txn_id=txn.id,
        source_account_id=account.id,
        pocket_account_id=other.id,
        amount=Decimal("10.00"),
        currency="EUR",
    )
    db_session.add(transfer)
    db_session.commit()
    txn.internal_transfer_id = transfer.id
    db_session.commit()

    try:
        with pytest.raises(HTTPException) as exc_info:
            update_transaction(
                txn.id,
                TransactionUpdate(amount=Decimal("20.00")),
                db=db_session,
            )
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[account.id, other.id])


def test_update_transaction_full_mutation_recalculates_balance(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    txn = _seed_transaction(
        db_session, user_id, account.id, "-10.00", datetime(2024, 4, 1), description="Coffee"
    )
    # Recompute functional_balance the way the transfer/interest flows would
    # have left it (starting_balance + sum(transactions)).
    account.functional_balance = Decimal("-10.00")
    db_session.commit()

    try:
        result = update_transaction(
            txn.id,
            TransactionUpdate(
                description="Coffee shop",
                amount=Decimal("15.00"),
                transaction_type="debit",
                account_id=account.id,
                booked_at=datetime(2024, 4, 1),
            ),
            db=db_session,
        )
        assert result.amount == pytest.approx(-15.00)
        assert result.description == "Coffee shop"

        db_session.refresh(account)
        assert account.functional_balance == pytest.approx(-15.00)
    finally:
        _cleanup(account_ids=[account.id])


def test_update_transaction_rejects_balancing_category(user_id, db_session):
    account = _seed_account(db_session, user_id)
    balancing_category = _seed_balancing_category(db_session, user_id)
    txn = _seed_transaction(
        db_session,
        user_id,
        account.id,
        "5.00",
        datetime(2024, 1, 1),
        category_id=balancing_category.id,
    )
    try:
        with pytest.raises(HTTPException) as exc_info:
            update_transaction(txn.id, TransactionUpdate(amount=Decimal("6.00")), db=db_session)
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[account.id], category_ids=[balancing_category.id])


# ---------------------------------------------------------------------------
# balancing upsert
# ---------------------------------------------------------------------------


def test_upsert_balancing_transaction_creates_then_updates(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    balancing_category = _seed_balancing_category(db_session, user_id)
    _seed_transaction(db_session, user_id, account.id, "100.00", datetime(2024, 5, 1))
    try:
        first = upsert_balancing_transaction(
            BalancingTransactionUpsert(
                account_id=account.id,
                target_balance=Decimal("150.00"),
                adjustment_date=datetime(2024, 5, 1),
                balancing_category_id=balancing_category.id,
            ),
            user_id=user_id,
            db=db_session,
        )
        assert first.transaction_id is not None
        assert first.is_update is False

        first_txn = db_session.query(Transaction).get(first.transaction_id)
        assert first_txn.amount == pytest.approx(50.00)

        second = upsert_balancing_transaction(
            BalancingTransactionUpsert(
                account_id=account.id,
                target_balance=Decimal("120.00"),
                adjustment_date=datetime(2024, 5, 1),
                balancing_category_id=balancing_category.id,
            ),
            user_id=user_id,
            db=db_session,
        )
        assert second.transaction_id == first.transaction_id
        assert second.is_update is True
        db_session.refresh(first_txn)
        assert first_txn.amount == pytest.approx(20.00)

        delete_balancing_transaction(first.transaction_id, user_id=user_id, db=db_session)
        assert db_session.query(Transaction).get(first.transaction_id) is None
    finally:
        _cleanup(account_ids=[account.id], category_ids=[balancing_category.id])


def test_delete_balancing_rejects_non_balancing_transaction(user_id, db_session):
    account = _seed_account(db_session, user_id)
    txn = _seed_transaction(db_session, user_id, account.id, "10.00", datetime(2024, 1, 1))
    try:
        with pytest.raises(HTTPException) as exc_info:
            delete_balancing_transaction(txn.id, user_id=user_id, db=db_session)
        assert exc_info.value.status_code == 400
    finally:
        _cleanup(account_ids=[account.id])


# ---------------------------------------------------------------------------
# delete-impact + bulk-delete
# ---------------------------------------------------------------------------


def test_delete_impact_computes_projected_balance(user_id, db_session):
    account = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    keep = _seed_transaction(db_session, user_id, account.id, "100.00", datetime(2024, 6, 1))
    to_delete = _seed_transaction(db_session, user_id, account.id, "-40.00", datetime(2024, 6, 2))
    try:
        impact = get_delete_impact(
            DeleteImpactRequest(transaction_ids=[to_delete.id]), user_id=user_id, db=db_session
        )
        assert impact.total_transactions == 1
        assert len(impact.account_impacts) == 1
        account_impact = impact.account_impacts[0]
        assert account_impact.account_id == account.id
        assert account_impact.amount_change == pytest.approx(40.00)
        assert account_impact.projected_balance == pytest.approx(100.00)
    finally:
        _cleanup(account_ids=[account.id], transaction_ids=[keep.id])


def test_bulk_delete_removes_linked_transfer_legs(user_id, db_session):
    source = _seed_account(db_session, user_id, starting_balance=Decimal("100"))
    destination = _seed_account(db_session, user_id, starting_balance=Decimal("0"))
    result = create_transfer_transaction(
        TransferTransactionCreate(
            source_account_id=source.id,
            destination_account_id=destination.id,
            amount=Decimal("20.00"),
            description="Move",
            booked_at=datetime(2024, 7, 1),
        ),
        user_id=user_id,
        db=db_session,
    )
    try:
        bulk_result = bulk_delete_transactions(
            BulkDeleteRequest(transaction_ids=[result.source_transaction_id]),
            user_id=user_id,
            db=db_session,
        )
        assert bulk_result.deleted_count == 2
        assert set(bulk_result.affected_account_ids) == {source.id, destination.id}
        assert db_session.query(Transaction).get(result.source_transaction_id) is None
        assert db_session.query(Transaction).get(result.destination_transaction_id) is None

        db_session.refresh(source)
        db_session.refresh(destination)
        assert source.functional_balance == pytest.approx(100.00)
        assert destination.functional_balance == pytest.approx(0.00)
    finally:
        _cleanup(account_ids=[source.id, destination.id])
