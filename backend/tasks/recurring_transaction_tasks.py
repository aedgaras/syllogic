"""Celery task that materializes real transactions from due recurring definitions."""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from celery_app import celery_app

from app.database import SessionLocal
from app.models import RecurringTransaction, Transaction, User
from app.services.account_balance_service import AccountBalanceService
from app.services.exchange_rate_service import ExchangeRateService
from app.services.recurring_transaction_schedule_service import compute_next_due_date

logger = logging.getLogger(__name__)


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@celery_app.task(name="tasks.recurring_transaction_tasks.check_due_recurring_transactions")
def check_due_recurring_transactions() -> dict:
    db = SessionLocal()
    try:
        today = date.today()
        due = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.is_active.is_(True),
                RecurringTransaction.auto_generate.is_(True),
                RecurringTransaction.next_due_date.isnot(None),
                RecurringTransaction.next_due_date <= today,
                RecurringTransaction.account_id.isnot(None),
            )
            .all()
        )

        created_transactions: list[Transaction] = []
        touched_accounts: dict[str, set[str]] = {}

        for recurring in due:
            # A row whose schedule has already run past end_date stops
            # generating rather than backfilling; label/history stays intact.
            if recurring.end_date and recurring.next_due_date > recurring.end_date:
                recurring.auto_generate = False
                continue

            txn = Transaction(
                user_id=recurring.user_id,
                account_id=recurring.account_id,
                transaction_type="debit",
                amount=_quantize(-abs(recurring.amount)),
                currency=recurring.currency or "EUR",
                description=recurring.name,
                merchant=recurring.merchant,
                category_id=recurring.category_id,
                category_system_id=recurring.category_id,
                booked_at=datetime.combine(recurring.next_due_date, datetime.min.time()),
                pending=False,
                include_in_analytics=True,
                recurring_transaction_id=recurring.id,
            )
            db.add(txn)
            created_transactions.append(txn)
            touched_accounts.setdefault(recurring.user_id, set()).add(str(recurring.account_id))

            next_due = compute_next_due_date(recurring.frequency, recurring.next_due_date)
            recurring.next_due_date = next_due
            if recurring.end_date and next_due > recurring.end_date:
                recurring.auto_generate = False

        db.commit()

        # Functional amounts + account balances, batched per affected user.
        for user_id, account_ids in touched_accounts.items():
            user = db.query(User).filter(User.id == user_id).first()
            functional_currency = (
                user.functional_currency if user and user.functional_currency else "EUR"
            )

            try:
                exchange_service = ExchangeRateService(db)
            except Exception as exc:  # noqa: BLE001 - tolerate missing yfinance, same as demo_seed_service
                logger.warning(
                    "[RECURRING] Could not initialize ExchangeRateService: %s", exc
                )
                exchange_service = None

            for txn in created_transactions:
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

        logger.info(
            "[RECURRING] Materialized %s transaction(s) from due recurring definitions",
            len(created_transactions),
        )
        return {"created": len(created_transactions)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
