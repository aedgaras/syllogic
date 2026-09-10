"""Materializes real transactions from recurring definitions.

Called from two places: the daily Celery beat
(`tasks/recurring_transaction_tasks.py`) and the manual "generate now"
endpoint (`routes/subscriptions.py`).

Two properties the naive "one row per beat tick" version did not have:

* **Catch-up.** A definition whose `next_due_date` lags several periods
  behind today (worker down, database restored from backup, schedule
  backdated by the user) is walked forward until it is in the future, so
  every missed occurrence lands on its own correct date instead of one per
  day of downtime.
* **No double counting.** A generated row is a placeholder for a charge the
  bank has not reported yet. If a real transaction for that occurrence is
  already linked to the definition, the occurrence is skipped rather than
  duplicated. The other direction -- the real row arriving *after* the
  placeholder -- is handled by `recurring_transaction_dedupe.py`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models import Category, RecurringTransaction, Transaction, User
from app.services.account_balance_service import AccountBalanceService
from app.services.exchange_rate_service import ExchangeRateService
from app.services.recurring_transaction_schedule_service import compute_next_due_date

logger = logging.getLogger(__name__)

# Upper bound on how many occurrences a single definition may catch up on in
# one run. A definition backdated by years would otherwise flood the ledger.
MAX_CATCHUP_OCCURRENCES = 24

# How far from the scheduled date a real transaction may sit and still count
# as "this occurrence already happened".
MATCH_WINDOW_DAYS = 7

# Relative amount tolerance when deciding whether a real transaction is this
# occurrence. Ignored for definitions flagged `is_variable_amount`.
AMOUNT_TOLERANCE_PERCENT = 0.15


@dataclass
class GenerationResult:
    created: list[Transaction] = field(default_factory=list)
    skipped_existing: int = 0
    definitions_touched: int = 0

    def as_dict(self) -> dict:
        return {
            "created": len(self.created),
            "created_ids": [str(t.id) for t in self.created],
            "skipped_existing": self.skipped_existing,
            "definitions_touched": self.definitions_touched,
        }


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def amounts_match(expected: Decimal, actual: Decimal, tolerance: float) -> bool:
    """True when `actual` is within `tolerance` (relative) of `expected`."""
    expected_abs = abs(Decimal(expected))
    actual_abs = abs(Decimal(actual))
    if expected_abs == 0:
        return actual_abs == 0
    diff = abs(expected_abs - actual_abs)
    return float(diff / expected_abs) <= tolerance


def occurrence_already_exists(
    db: Session,
    recurring: RecurringTransaction,
    due: date,
    window_days: int = MATCH_WINDOW_DAYS,
) -> bool:
    """True when a transaction already covers `due` for this definition.

    Counts both a real (bank/CSV/manual) row that was linked to the
    definition and a placeholder this generator produced earlier, so
    re-running -- or pressing "generate now" on an already-materialized
    occurrence -- is a no-op rather than a duplicate.
    """
    candidates = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == recurring.user_id,
            Transaction.recurring_transaction_id == recurring.id,
            sa_func.date(Transaction.booked_at) >= due - timedelta(days=window_days),
            sa_func.date(Transaction.booked_at) <= due + timedelta(days=window_days),
        )
        .all()
    )
    for txn in candidates:
        if txn.auto_generated:
            # Our own placeholder for this occurrence.
            if txn.booked_at.date() == due:
                return True
            continue
        if recurring.is_variable_amount:
            return True
        if amounts_match(recurring.amount, txn.amount, AMOUNT_TOLERANCE_PERCENT):
            return True
    return False


def _build_transaction(db: Session, recurring: RecurringTransaction, due: date) -> Transaction:
    is_income = False
    if recurring.category_id:
        category = db.query(Category).filter(Category.id == recurring.category_id).first()
        is_income = bool(category and category.category_type == "income")

    amount = _quantize(abs(recurring.amount)) if is_income else _quantize(-abs(recurring.amount))
    return Transaction(
        user_id=recurring.user_id,
        account_id=recurring.account_id,
        transaction_type="credit" if is_income else "debit",
        amount=amount,
        currency=recurring.currency or "EUR",
        description=recurring.name,
        merchant=recurring.merchant,
        category_id=recurring.category_id,
        category_system_id=recurring.category_id,
        booked_at=datetime.combine(due, datetime.min.time()),
        pending=False,
        include_in_analytics=True,
        auto_generated=True,
        logo_id=recurring.logo_id,
        recurring_transaction_id=recurring.id,
    )


def _load_definitions(
    db: Session,
    today: date,
    user_id: Optional[str],
    recurring_ids: Optional[Iterable[UUID]],
    include_not_yet_due: bool,
) -> list[RecurringTransaction]:
    query = db.query(RecurringTransaction).filter(
        RecurringTransaction.is_active.is_(True),
        RecurringTransaction.auto_generate.is_(True),
        RecurringTransaction.next_due_date.isnot(None),
        RecurringTransaction.account_id.isnot(None),
    )
    if not include_not_yet_due:
        query = query.filter(RecurringTransaction.next_due_date <= today)
    if user_id:
        query = query.filter(RecurringTransaction.user_id == user_id)
    if recurring_ids is not None:
        query = query.filter(RecurringTransaction.id.in_(list(recurring_ids)))
    return query.all()


def generate_due_transactions(
    db: Session,
    *,
    today: Optional[date] = None,
    user_id: Optional[str] = None,
    recurring_ids: Optional[Iterable[UUID]] = None,
    single_occurrence: bool = False,
) -> GenerationResult:
    """Materialize every occurrence due on or before `today`.

    `single_occurrence` generates exactly one occurrence per definition even
    when it is not due yet -- what the manual "generate now" action wants.
    Commits, then recomputes functional amounts and account balances for
    every affected account.
    """
    today = today or date.today()
    result = GenerationResult()
    touched_accounts: dict[str, set[str]] = {}

    definitions = _load_definitions(
        db, today, user_id, recurring_ids, include_not_yet_due=single_occurrence
    )

    for recurring in definitions:
        produced = 0
        while recurring.next_due_date is not None:
            due = recurring.next_due_date
            if not single_occurrence and due > today:
                break
            # A schedule that has run past its end date stops generating
            # rather than backfilling; label/history stays intact.
            if recurring.end_date and due > recurring.end_date:
                recurring.auto_generate = False
                break
            if produced >= MAX_CATCHUP_OCCURRENCES:
                logger.warning(
                    "[RECURRING] Definition %s hit the %s-occurrence catch-up cap; "
                    "remaining occurrences roll into the next run",
                    recurring.id,
                    MAX_CATCHUP_OCCURRENCES,
                )
                break

            if occurrence_already_exists(db, recurring, due):
                result.skipped_existing += 1
                logger.info(
                    "[RECURRING] Skipped occurrence %s of definition %s: "
                    "a transaction already covers it",
                    due,
                    recurring.id,
                )
            else:
                txn = _build_transaction(db, recurring, due)
                db.add(txn)
                result.created.append(txn)
                touched_accounts.setdefault(recurring.user_id, set()).add(str(recurring.account_id))

            produced += 1
            recurring.next_due_date = compute_next_due_date(recurring.frequency, due)
            if recurring.end_date and recurring.next_due_date > recurring.end_date:
                recurring.auto_generate = False
                break
            if single_occurrence:
                break

        if produced:
            result.definitions_touched += 1

    db.commit()

    _backfill_functional_amounts_and_balances(db, result.created, touched_accounts)

    logger.info(
        "[RECURRING] Materialized %s transaction(s), skipped %s already-covered occurrence(s)",
        len(result.created),
        result.skipped_existing,
    )
    return result


def _backfill_functional_amounts_and_balances(
    db: Session,
    created: list[Transaction],
    touched_accounts: dict[str, set[str]],
) -> None:
    for user_id, account_ids in touched_accounts.items():
        user = db.query(User).filter(User.id == user_id).first()
        functional_currency = (
            user.functional_currency if user and user.functional_currency else "EUR"
        )

        try:
            exchange_service = ExchangeRateService(db)
        except Exception as exc:  # noqa: BLE001 - tolerate missing yfinance, same as demo_seed_service
            logger.warning("[RECURRING] Could not initialize ExchangeRateService: %s", exc)
            exchange_service = None

        for txn in created:
            if txn.user_id != user_id:
                continue
            if txn.currency == functional_currency:
                txn.functional_amount = txn.amount
            elif exchange_service is not None:
                rate = exchange_service.get_exchange_rate(
                    base_currency=txn.currency,
                    target_currency=functional_currency,
                    for_date=txn.booked_at.date(),
                )
                txn.functional_amount = _quantize(txn.amount * rate) if rate else None

        db.commit()

        balance_service = AccountBalanceService(db)
        balance_service.calculate_account_balances(user_id, account_ids=list(account_ids))
        balance_service.calculate_account_timeseries(user_id, account_ids=list(account_ids))
