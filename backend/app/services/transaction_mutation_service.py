"""Business logic for transaction mutations that affect account balances:
transfers, interest, full edits, balancing entries, and deletes.

Port of frontend/lib/actions/transactions.ts. Every method that changes an
account's transaction history ends by calling AccountBalanceService's daily
snapshot recalculation, matching the frontend's "mutate then recalculate"
pattern. Callers (routes) are responsible for translating raised
ValueError/LookupError into HTTP responses.
"""

from __future__ import annotations

from datetime import datetime, date as date_type
from decimal import Decimal
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Category,
    Holding,
    HoldingValuation,
    InternalTransfer,
    Transaction,
    User,
)
from app.services.account_balance_service import AccountBalanceService
from app.services.exchange_rate_service import ExchangeRateService
from app.services.system_categories import (
    INTEREST_CATEGORY_SEEDS,
    TRANSFER_CATEGORY_SEEDS,
    ensure_system_categories,
)

INVESTMENT_ACCOUNT_TYPES = {"investment", "investment_brokerage", "investment_manual", "brokerage"}
# Only investment_manual gets an automatic cash holding synced from transfers,
# mirroring the frontend's syncCashHolding — investment_brokerage cash is
# reconciled separately from broker statements.
CASH_HOLDING_SYNCED_ACCOUNT_TYPE = "investment_manual"
BALANCING_CATEGORY_NAME = "Balancing Transfer"

_CENTS = Decimal("0.01")
_HOLDING_QTY = Decimal("0.00000001")


def _resolve_transfer_system_key(destination_account_type: str) -> str:
    if destination_account_type == "savings":
        return "savings_transfer"
    if destination_account_type in INVESTMENT_ACCOUNT_TYPES:
        return "investment_transfer"
    return "internal_transfer"


class TransactionMutationService:
    def __init__(self, db: Session, user_id: str):
        self.db = db
        self.user_id = user_id
        self.balance_service = AccountBalanceService(db)
        self.fx_service = ExchangeRateService(db)

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------
    def _get_owned_account(self, account_id: UUID) -> Optional[Account]:
        return (
            self.db.query(Account)
            .filter(Account.id == account_id, Account.user_id == self.user_id)
            .first()
        )

    def _functional_currency(self) -> str:
        user = self.db.query(User).filter(User.id == self.user_id).first()
        return (user.functional_currency if user else None) or "EUR"

    def _get_functional_rate(
        self, currency: str, functional_currency: str, on: date_type
    ) -> Optional[Decimal]:
        if currency == functional_currency:
            return Decimal("1")
        return self.fx_service.get_exchange_rate(currency, functional_currency, on)

    def _find_transfer_category(self, destination_account_type: str) -> Optional[Category]:
        ensure_system_categories(self.db, self.user_id, TRANSFER_CATEGORY_SEEDS)
        target_key = _resolve_transfer_system_key(destination_account_type)
        category = (
            self.db.query(Category)
            .filter(Category.user_id == self.user_id, Category.system_key == target_key)
            .first()
        )
        if category:
            return category
        # Defensive fallback for pre-migration categories that predate system_key.
        return (
            self.db.query(Category)
            .filter(Category.user_id == self.user_id, Category.category_type == "transfer")
            .order_by(Category.is_system.desc(), Category.created_at.asc())
            .first()
        )

    def _find_interest_category(self) -> Optional[Category]:
        ensure_system_categories(self.db, self.user_id, INTEREST_CATEGORY_SEEDS)
        return (
            self.db.query(Category)
            .filter(Category.user_id == self.user_id, Category.system_key == "savings_interest")
            .first()
        )

    def _recompute_functional_balance(self, account: Account) -> Decimal:
        total = self.db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(
            Transaction.account_id == account.id, Transaction.user_id == self.user_id
        ).scalar() or Decimal("0")
        starting = account.starting_balance or Decimal("0")
        new_balance = (starting + total).quantize(_CENTS)
        account.functional_balance = new_balance
        account.updated_at = datetime.utcnow()
        return new_balance

    def _recalculate_from_date(
        self,
        account_id: UUID,
        from_date: datetime,
        starting_balance: Decimal,
        exclude_transaction_id: Optional[UUID] = None,
    ) -> None:
        self.balance_service.recalculate_from_date(
            account_id, from_date, starting_balance, exclude_transaction_id
        )

    def _sync_cash_holding(
        self, account: Account, signed_amount: Decimal, functional_rate: Optional[Decimal]
    ) -> None:
        if account.account_type != CASH_HOLDING_SYNCED_ACCOUNT_TYPE:
            return
        currency = account.currency or "EUR"
        holding = (
            self.db.query(Holding)
            .filter(
                Holding.account_id == account.id,
                Holding.symbol == currency,
                Holding.instrument_type == "cash",
            )
            .first()
        )
        if holding:
            holding.quantity = (holding.quantity + signed_amount).quantize(_HOLDING_QTY)
            holding.updated_at = datetime.utcnow()
        else:
            holding = Holding(
                user_id=self.user_id,
                account_id=account.id,
                symbol=currency,
                name=f"Cash ({currency})",
                currency=currency,
                instrument_type="cash",
                quantity=signed_amount.quantize(_HOLDING_QTY),
                source="manual",
            )
            self.db.add(holding)
            self.db.flush()

        quantity = holding.quantity
        rate = functional_rate if functional_rate is not None else Decimal("1")
        value_user_currency = (quantity * rate).quantize(_CENTS)
        today = datetime.utcnow().date()
        valuation = (
            self.db.query(HoldingValuation)
            .filter(HoldingValuation.holding_id == holding.id, HoldingValuation.date == today)
            .first()
        )
        if valuation:
            valuation.quantity = quantity
            valuation.price = Decimal("1")
            valuation.value_user_currency = value_user_currency
        else:
            self.db.add(
                HoldingValuation(
                    holding_id=holding.id,
                    date=today,
                    quantity=quantity,
                    price=Decimal("1"),
                    value_user_currency=value_user_currency,
                )
            )

    def _is_balancing_category(self, category_id: Optional[UUID]) -> bool:
        if not category_id:
            return False
        category = self.db.query(Category).filter(Category.id == category_id).first()
        return bool(category and category.name == BALANCING_CATEGORY_NAME)

    # ------------------------------------------------------------------
    # Transfers
    # ------------------------------------------------------------------
    def create_transfer(
        self,
        source_account_id: UUID,
        destination_account_id: UUID,
        amount: Decimal,
        description: str,
        booked_at: datetime,
    ) -> Tuple[Transaction, Transaction]:
        description = description.strip()
        if not description:
            raise ValueError("Description is required")
        if amount is None or amount <= 0:
            raise ValueError("Amount must be greater than zero")
        if source_account_id == destination_account_id:
            raise ValueError("Source and destination accounts must be different")

        accounts = {
            a.id: a
            for a in self.db.query(Account)
            .filter(
                Account.id.in_([source_account_id, destination_account_id]),
                Account.user_id == self.user_id,
            )
            .all()
        }
        source_account = accounts.get(source_account_id)
        destination_account = accounts.get(destination_account_id)
        if not source_account or not destination_account:
            raise LookupError("One or both accounts were not found")

        source_currency = source_account.currency or "EUR"
        destination_currency = destination_account.currency or "EUR"
        if source_currency != destination_currency:
            raise ValueError(
                "Transfers between accounts with different currencies are not supported yet"
            )

        transfer_category = self._find_transfer_category(destination_account.account_type)
        functional_currency = self._functional_currency()
        functional_rate = self._get_functional_rate(
            source_currency, functional_currency, booked_at.date()
        )

        amount = abs(amount)
        source_functional_amount = (
            None if functional_rate is None else (-amount * functional_rate).quantize(_CENTS)
        )
        destination_functional_amount = (
            None if functional_rate is None else (amount * functional_rate).quantize(_CENTS)
        )

        source_txn = Transaction(
            user_id=self.user_id,
            account_id=source_account.id,
            transaction_type="debit",
            amount=-amount,
            currency=source_currency,
            functional_amount=source_functional_amount,
            description=description,
            merchant=destination_account.name,
            category_system_id=transfer_category.id if transfer_category else None,
            booked_at=booked_at,
            pending=False,
            include_in_analytics=False,
        )
        destination_txn = Transaction(
            user_id=self.user_id,
            account_id=destination_account.id,
            transaction_type="credit",
            amount=amount,
            currency=destination_currency,
            functional_amount=destination_functional_amount,
            description=description,
            merchant=source_account.name,
            category_system_id=transfer_category.id if transfer_category else None,
            booked_at=booked_at,
            pending=False,
            include_in_analytics=False,
        )
        self.db.add_all([source_txn, destination_txn])
        self.db.flush()

        transfer = InternalTransfer(
            user_id=self.user_id,
            source_txn_id=source_txn.id,
            mirror_txn_id=destination_txn.id,
            source_account_id=source_account.id,
            pocket_account_id=destination_account.id,
            amount=amount,
            currency=source_currency,
        )
        self.db.add(transfer)
        self.db.flush()

        source_txn.internal_transfer_id = transfer.id
        destination_txn.internal_transfer_id = transfer.id

        for account in (source_account, destination_account):
            self._recompute_functional_balance(account)

        self._sync_cash_holding(source_account, -amount, functional_rate)
        self._sync_cash_holding(destination_account, amount, functional_rate)

        self.db.commit()

        for account in (source_account, destination_account):
            self._recalculate_from_date(
                account.id, booked_at, account.starting_balance or Decimal("0")
            )
        self.db.commit()

        return source_txn, destination_txn

    def convert_to_transfer(
        self,
        transaction_id: UUID,
        source_account_id: UUID,
        destination_account_id: UUID,
        amount: Decimal,
        description: str,
        booked_at: datetime,
    ) -> Tuple[Transaction, Transaction]:
        description = description.strip()
        if not description:
            raise ValueError("Description is required")
        if amount is None or amount <= 0:
            raise ValueError("Amount must be greater than zero")
        if source_account_id == destination_account_id:
            raise ValueError("Source and destination accounts must be different")

        existing = (
            self.db.query(Transaction)
            .filter(Transaction.id == transaction_id, Transaction.user_id == self.user_id)
            .first()
        )
        if not existing:
            raise LookupError("Transaction not found")
        if existing.internal_transfer_id:
            raise ValueError("This transaction is already part of a transfer")
        if self._is_balancing_category(existing.category_id):
            raise ValueError("Balancing transfers cannot be converted")

        original_account = self._get_owned_account(existing.account_id)

        accounts = {
            a.id: a
            for a in self.db.query(Account)
            .filter(
                Account.id.in_([source_account_id, destination_account_id]),
                Account.user_id == self.user_id,
            )
            .all()
        }
        source_account = accounts.get(source_account_id)
        destination_account = accounts.get(destination_account_id)
        if not source_account or not destination_account:
            raise LookupError("One or both accounts were not found")

        source_currency = source_account.currency or "EUR"
        destination_currency = destination_account.currency or "EUR"
        if source_currency != destination_currency:
            raise ValueError(
                "Transfers between accounts with different currencies are not supported yet"
            )

        transfer_category = self._find_transfer_category(destination_account.account_type)
        functional_currency = self._functional_currency()
        functional_rate = self._get_functional_rate(
            source_currency, functional_currency, booked_at.date()
        )

        amount = abs(amount)
        source_functional_amount = (
            None if functional_rate is None else (-amount * functional_rate).quantize(_CENTS)
        )
        destination_functional_amount = (
            None if functional_rate is None else (amount * functional_rate).quantize(_CENTS)
        )

        affected: Dict[UUID, Dict] = {}
        if original_account:
            affected[existing.account_id] = {
                "starting_balance": original_account.starting_balance or Decimal("0"),
                "from_date": min(existing.booked_at, booked_at),
            }
        for account in (source_account, destination_account):
            current = affected.get(account.id)
            if not current:
                affected[account.id] = {
                    "starting_balance": account.starting_balance or Decimal("0"),
                    "from_date": booked_at,
                }
            elif booked_at < current["from_date"]:
                current["from_date"] = booked_at

        existing.account_id = source_account.id
        existing.transaction_type = "debit"
        existing.amount = -amount
        existing.currency = source_currency
        existing.functional_amount = source_functional_amount
        existing.description = description
        existing.merchant = destination_account.name
        existing.creditor = None
        existing.debtor = None
        existing.counterparty_iban_ciphertext = None
        existing.counterparty_iban_hash = None
        existing.category_id = None
        existing.category_system_id = transfer_category.id if transfer_category else None
        existing.recurring_transaction_id = None
        existing.booked_at = booked_at
        existing.pending = False
        existing.include_in_analytics = False
        existing.updated_at = datetime.utcnow()

        destination_txn = Transaction(
            user_id=self.user_id,
            account_id=destination_account.id,
            transaction_type="credit",
            amount=amount,
            currency=destination_currency,
            functional_amount=destination_functional_amount,
            description=description,
            merchant=source_account.name,
            category_system_id=transfer_category.id if transfer_category else None,
            booked_at=booked_at,
            pending=False,
            include_in_analytics=False,
        )
        self.db.add(destination_txn)
        self.db.flush()

        transfer = InternalTransfer(
            user_id=self.user_id,
            source_txn_id=existing.id,
            mirror_txn_id=destination_txn.id,
            source_account_id=source_account.id,
            pocket_account_id=destination_account.id,
            amount=amount,
            currency=source_currency,
        )
        self.db.add(transfer)
        self.db.flush()

        existing.internal_transfer_id = transfer.id
        destination_txn.internal_transfer_id = transfer.id

        for account_id in affected:
            account = self.db.query(Account).filter(Account.id == account_id).first()
            if account:
                self._recompute_functional_balance(account)

        self._sync_cash_holding(source_account, -amount, functional_rate)
        self._sync_cash_holding(destination_account, amount, functional_rate)

        self.db.commit()

        for account_id, info in affected.items():
            self._recalculate_from_date(account_id, info["from_date"], info["starting_balance"])
        self.db.commit()

        return existing, destination_txn

    # ------------------------------------------------------------------
    # Interest
    # ------------------------------------------------------------------
    def add_interest(
        self,
        account_id: UUID,
        amount: Decimal,
        booked_at: datetime,
        description: Optional[str],
    ) -> Transaction:
        if amount is None or amount <= 0:
            raise ValueError("Amount must be greater than zero")

        account = self._get_owned_account(account_id)
        if not account:
            raise LookupError("Account not found")
        if account.account_type != "savings":
            raise ValueError("Interest can only be added to savings accounts")

        interest_category = self._find_interest_category()
        amount = abs(amount)
        currency = account.currency or "EUR"
        functional_currency = self._functional_currency()
        functional_rate = self._get_functional_rate(currency, functional_currency, booked_at.date())
        functional_amount = (
            None if functional_rate is None else (amount * functional_rate).quantize(_CENTS)
        )
        clean_description = (description or "").strip() or "Interest earned"

        txn = Transaction(
            user_id=self.user_id,
            account_id=account.id,
            transaction_type="credit",
            amount=amount,
            currency=currency,
            functional_amount=functional_amount,
            description=clean_description,
            category_system_id=interest_category.id if interest_category else None,
            booked_at=booked_at,
            pending=False,
            include_in_analytics=True,
        )
        self.db.add(txn)
        self.db.flush()

        self._recompute_functional_balance(account)
        self.db.commit()

        self._recalculate_from_date(account.id, booked_at, account.starting_balance or Decimal("0"))
        self.db.commit()

        return txn

    def get_accrued_interest(self, account_id: UUID) -> Decimal:
        total = (
            self.db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .join(Category, Transaction.category_system_id == Category.id)
            .filter(
                Transaction.account_id == account_id,
                Transaction.user_id == self.user_id,
                Category.system_key == "savings_interest",
            )
            .scalar()
        )
        return total or Decimal("0")

    # ------------------------------------------------------------------
    # Full update
    # ------------------------------------------------------------------
    def update_transaction(self, transaction_id: UUID, updates: Dict) -> Transaction:
        existing = (
            self.db.query(Transaction)
            .filter(Transaction.id == transaction_id, Transaction.user_id == self.user_id)
            .first()
        )
        if not existing:
            raise LookupError("Transaction not found")

        is_full_mutation = any(
            key in updates for key in ("account_id", "amount", "transaction_type", "booked_at")
        )
        if is_full_mutation and existing.internal_transfer_id:
            raise ValueError("Unlink the internal transfer before editing it")
        if is_full_mutation and self._is_balancing_category(existing.category_id):
            raise ValueError("Balancing transfers cannot be edited")

        if "description" in updates:
            description = (updates["description"] or "").strip()
            if not description:
                raise ValueError("Description is required")
            updates = {**updates, "description": description}

        if updates.get("category_id"):
            category = (
                self.db.query(Category)
                .filter(Category.id == updates["category_id"], Category.user_id == self.user_id)
                .first()
            )
            if not category:
                raise LookupError("Category not found")

        old_account_id = existing.account_id
        old_booked_at = existing.booked_at
        old_account = self.db.query(Account).filter(Account.id == old_account_id).first()

        if is_full_mutation:
            new_account_id = updates.get("account_id", existing.account_id)
            account = self._get_owned_account(new_account_id)
            if not account:
                raise LookupError("Account not found")

            transaction_type = updates.get("transaction_type", existing.transaction_type)
            if transaction_type not in ("debit", "credit"):
                raise ValueError("A valid transaction type is required")

            if "amount" in updates and updates["amount"] is not None:
                if updates["amount"] <= 0:
                    raise ValueError("Amount must be greater than zero")
                signed_amount = (
                    -abs(updates["amount"])
                    if transaction_type == "debit"
                    else abs(updates["amount"])
                )
            else:
                signed_amount = existing.amount

            booked_at = updates.get("booked_at", existing.booked_at)
            currency = account.currency or "EUR"
            functional_currency = self._functional_currency()
            functional_rate = self._get_functional_rate(
                currency, functional_currency, booked_at.date()
            )
            functional_amount = (
                None
                if functional_rate is None
                else (signed_amount * functional_rate).quantize(_CENTS)
            )

            existing.account_id = account.id
            existing.amount = signed_amount
            existing.functional_amount = functional_amount
            existing.currency = currency
            existing.transaction_type = transaction_type
            existing.booked_at = booked_at

        for field in ("description", "merchant", "categorization_instructions", "enrichment_data"):
            if field in updates:
                setattr(existing, field, updates[field])
        if "category_id" in updates:
            existing.category_id = updates["category_id"]
        if "category_system_id" in updates:
            existing.category_system_id = updates["category_system_id"]

        existing.updated_at = datetime.utcnow()
        self.db.flush()

        if not is_full_mutation:
            self.db.commit()
            return existing

        affected: Dict[UUID, Dict] = {
            old_account_id: {
                "starting_balance": (old_account.starting_balance if old_account else None)
                or Decimal("0"),
                "from_date": min(old_booked_at, existing.booked_at),
            }
        }
        if existing.account_id != old_account_id:
            new_account = self.db.query(Account).filter(Account.id == existing.account_id).first()
            affected[existing.account_id] = {
                "starting_balance": (new_account.starting_balance if new_account else None)
                or Decimal("0"),
                "from_date": existing.booked_at,
            }

        for account_id in affected:
            account = self.db.query(Account).filter(Account.id == account_id).first()
            if account:
                self._recompute_functional_balance(account)

        self.db.commit()

        for account_id, info in affected.items():
            self._recalculate_from_date(account_id, info["from_date"], info["starting_balance"])
        self.db.commit()

        return existing

    # ------------------------------------------------------------------
    # Balancing transactions
    # ------------------------------------------------------------------
    def create_or_update_balancing(
        self,
        account_id: UUID,
        target_balance: Decimal,
        adjustment_date: datetime,
        balancing_category_id: UUID,
    ) -> Tuple[Optional[UUID], bool]:
        account = self._get_owned_account(account_id)
        if not account:
            raise LookupError("Account not found")
        category = (
            self.db.query(Category)
            .filter(Category.id == balancing_category_id, Category.user_id == self.user_id)
            .first()
        )
        if not category or category.name != BALANCING_CATEGORY_NAME:
            raise ValueError("Invalid balancing transfer category")

        start_of_day = datetime(adjustment_date.year, adjustment_date.month, adjustment_date.day)
        end_of_day = start_of_day.replace(hour=23, minute=59, second=59, microsecond=999000)

        existing = (
            self.db.query(Transaction)
            .filter(
                Transaction.account_id == account_id,
                Transaction.category_id == balancing_category_id,
                Transaction.booked_at >= start_of_day,
                Transaction.booked_at <= end_of_day,
            )
            .first()
        )

        starting_balance = account.starting_balance or Decimal("0")

        balance_query = self.db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(
            Transaction.account_id == account_id, Transaction.booked_at <= end_of_day
        )
        if existing:
            balance_query = balance_query.filter(Transaction.id != existing.id)
        transaction_sum_without_adjustment = balance_query.scalar() or Decimal("0")
        current_balance_without_adjustment = starting_balance + transaction_sum_without_adjustment
        difference = target_balance - current_balance_without_adjustment

        if abs(difference) < Decimal("0.01"):
            if existing:
                existing_id = existing.id
                self.db.delete(existing)
                self.db.flush()
                self._recalculate_from_date(
                    account_id, adjustment_date, starting_balance, existing_id
                )
                self._recompute_functional_balance(account)
                self.db.commit()
                return None, True
            return None, False

        transaction_type = "credit" if difference > 0 else "debit"
        amount = difference

        if existing:
            existing.amount = amount
            existing.transaction_type = transaction_type
            existing.updated_at = datetime.utcnow()
            transaction_id = existing.id
            is_update = True
        else:
            txn = Transaction(
                user_id=self.user_id,
                account_id=account_id,
                amount=amount,
                description="Balance adjustment",
                category_id=balancing_category_id,
                booked_at=adjustment_date,
                transaction_type=transaction_type,
                currency=account.currency or "EUR",
            )
            self.db.add(txn)
            self.db.flush()
            transaction_id = txn.id
            is_update = False

        self._recalculate_from_date(account_id, adjustment_date, starting_balance)
        self._recompute_functional_balance(account)
        self.db.commit()
        return transaction_id, is_update

    def delete_balancing(self, transaction_id: UUID) -> None:
        txn = (
            self.db.query(Transaction)
            .filter(Transaction.id == transaction_id, Transaction.user_id == self.user_id)
            .first()
        )
        if not txn:
            raise LookupError("Transaction not found")
        if not self._is_balancing_category(txn.category_id):
            raise ValueError("Only balancing transfers can be reverted")

        account = self.db.query(Account).filter(Account.id == txn.account_id).first()
        if not account:
            raise LookupError("Transaction account not found")

        starting_balance = account.starting_balance or Decimal("0")
        booked_at = txn.booked_at
        account_id = txn.account_id

        self.db.delete(txn)
        self.db.flush()

        self._recalculate_from_date(account_id, booked_at, starting_balance, transaction_id)
        self._recompute_functional_balance(account)
        self.db.commit()

    # ------------------------------------------------------------------
    # Deletion
    # ------------------------------------------------------------------
    def _include_linked_transfer_transactions(self, transaction_ids: List[UUID]) -> List[UUID]:
        ids = list(dict.fromkeys(transaction_ids))
        if not ids:
            return ids
        transfers = (
            self.db.query(InternalTransfer)
            .filter(
                InternalTransfer.user_id == self.user_id,
                or_(
                    InternalTransfer.source_txn_id.in_(ids),
                    InternalTransfer.mirror_txn_id.in_(ids),
                ),
            )
            .all()
        )
        for transfer in transfers:
            ids.append(transfer.source_txn_id)
            if transfer.mirror_txn_id:
                ids.append(transfer.mirror_txn_id)
        return list(dict.fromkeys(ids))

    def get_delete_impact(
        self, transaction_ids: List[UUID]
    ) -> Tuple[List[Dict], int, Optional[datetime]]:
        ids_to_delete = self._include_linked_transfer_transactions(transaction_ids)
        txns = (
            self.db.query(Transaction)
            .filter(Transaction.id.in_(ids_to_delete), Transaction.user_id == self.user_id)
            .all()
        )
        if not txns:
            raise LookupError("Transactions not found")

        by_account: Dict[UUID, Dict] = {}
        for txn in txns:
            entry = by_account.setdefault(
                txn.account_id, {"amount_sum": Decimal("0"), "earliest_date": txn.booked_at}
            )
            entry["amount_sum"] += txn.amount
            if txn.booked_at < entry["earliest_date"]:
                entry["earliest_date"] = txn.booked_at

        account_ids = list(by_account.keys())
        remaining_rows = (
            self.db.query(
                Transaction.account_id, func.coalesce(func.sum(Transaction.amount), 0).label("sum")
            )
            .filter(
                Transaction.account_id.in_(account_ids),
                Transaction.user_id == self.user_id,
                ~Transaction.id.in_(ids_to_delete),
            )
            .group_by(Transaction.account_id)
            .all()
        )
        remaining_by_account = {row.account_id: row.sum for row in remaining_rows}
        accounts = {
            a.id: a for a in self.db.query(Account).filter(Account.id.in_(account_ids)).all()
        }

        impacts: List[Dict] = []
        earliest_overall: Optional[datetime] = None
        for account_id, info in by_account.items():
            account = accounts.get(account_id)
            if not account:
                continue
            projected_balance = (account.starting_balance or Decimal("0")) + (
                remaining_by_account.get(account_id) or Decimal("0")
            )
            impacts.append(
                {
                    "account_id": account_id,
                    "account_name": account.name,
                    "currency": account.currency or "EUR",
                    # Debits are negative, credits positive; deleting a debit
                    # raises the balance, deleting a credit lowers it.
                    "amount_change": -info["amount_sum"],
                    "current_balance": account.functional_balance or Decimal("0"),
                    "projected_balance": projected_balance,
                    "balance_is_anchored": bool(account.balance_is_anchored),
                }
            )
            if earliest_overall is None or info["earliest_date"] < earliest_overall:
                earliest_overall = info["earliest_date"]

        return impacts, len(txns), earliest_overall

    def bulk_delete(self, transaction_ids: List[UUID]) -> Tuple[List[UUID], int]:
        ids_to_delete = self._include_linked_transfer_transactions(transaction_ids)
        txns = (
            self.db.query(Transaction)
            .filter(Transaction.id.in_(ids_to_delete), Transaction.user_id == self.user_id)
            .all()
        )
        if not txns:
            raise LookupError("Transactions not found")

        account_data: Dict[UUID, Dict] = {}
        for txn in txns:
            entry = account_data.setdefault(txn.account_id, {"earliest_date": txn.booked_at})
            if txn.booked_at < entry["earliest_date"]:
                entry["earliest_date"] = txn.booked_at

        accounts = {
            a.id: a
            for a in self.db.query(Account).filter(Account.id.in_(list(account_data.keys()))).all()
        }
        for account_id, entry in account_data.items():
            account = accounts.get(account_id)
            entry["starting_balance"] = (account.starting_balance if account else None) or Decimal(
                "0"
            )

        deleted_ids = [txn.id for txn in txns]
        self.db.query(Transaction).filter(
            Transaction.id.in_(deleted_ids), Transaction.user_id == self.user_id
        ).delete(synchronize_session=False)
        self.db.flush()

        affected_account_ids: List[UUID] = []
        for account_id in account_data:
            affected_account_ids.append(account_id)
            account = accounts.get(account_id)
            if account:
                self._recompute_functional_balance(account)

        self.db.commit()

        for account_id, entry in account_data.items():
            self._recalculate_from_date(
                account_id, entry["earliest_date"], entry["starting_balance"]
            )
        self.db.commit()

        return affected_account_ids, len(txns)
