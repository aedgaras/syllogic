"""Reconciles generated placeholders with the real transactions that follow.

`recurring_transaction_generator.py` books a placeholder on the scheduled
date because the bank has not reported the charge yet. Days later the real
row arrives through bank sync, CSV import or manual entry. Without
reconciliation the ledger would carry both, double counting the expense.

`supersede_generated_duplicates` runs at the end of the post-import pipeline,
once that pipeline has linked the incoming rows to their recurring
definition. An untouched placeholder is deleted; one the user has edited is
kept but dropped out of analytics, so their edit is never silently
destroyed while the double count still goes away.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models import RecurringTransaction, Transaction
from app.services.recurring_transaction_generator import (
    AMOUNT_TOLERANCE_PERCENT,
    MATCH_WINDOW_DAYS,
    amounts_match,
)

logger = logging.getLogger(__name__)


def _placeholder_is_untouched(placeholder: Transaction, recurring: RecurringTransaction) -> bool:
    """True when the placeholder still looks exactly as generated."""
    if placeholder.description != recurring.name:
        return False
    if placeholder.category_id != recurring.category_id:
        return False
    if not placeholder.include_in_analytics:
        return False
    return abs(placeholder.amount) == abs(recurring.amount)


def find_placeholder(
    db: Session,
    *,
    user_id: str,
    account_id,
    recurring_id,
    booked_at,
    amount,
    is_variable_amount: bool = False,
    window_days: int = MATCH_WINDOW_DAYS,
) -> Optional[Transaction]:
    """Find the generated placeholder an incoming real transaction replaces."""
    target_date = booked_at.date() if hasattr(booked_at, "date") else booked_at
    candidates = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.account_id == account_id,
            Transaction.recurring_transaction_id == recurring_id,
            Transaction.auto_generated.is_(True),
            sa_func.date(Transaction.booked_at) >= target_date - timedelta(days=window_days),
            sa_func.date(Transaction.booked_at) <= target_date + timedelta(days=window_days),
        )
        .order_by(Transaction.booked_at)
        .all()
    )
    for candidate in candidates:
        if is_variable_amount or amounts_match(
            candidate.amount, Decimal(str(amount)), AMOUNT_TOLERANCE_PERCENT
        ):
            return candidate
    return None


def supersede_generated_duplicates(
    db: Session,
    user_id: str,
    transaction_ids: Optional[Iterable[str]] = None,
    window_days: int = MATCH_WINDOW_DAYS,
    commit: bool = True,
) -> dict:
    """Remove placeholders that a real transaction has since covered.

    `transaction_ids` narrows the scan to rows a just-finished import
    produced; omit it to sweep every real recurring-linked transaction of the
    user.

    Returns counts plus the account ids whose balances the caller should
    recompute.
    """
    query = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.recurring_transaction_id.isnot(None),
        Transaction.auto_generated.is_(False),
    )
    if transaction_ids is not None:
        ids = list(transaction_ids)
        if not ids:
            return {"deleted": 0, "demoted": 0, "account_ids": []}
        query = query.filter(Transaction.id.in_(ids))

    real_transactions = query.all()
    if not real_transactions:
        return {"deleted": 0, "demoted": 0, "account_ids": []}

    definitions: dict[UUID, RecurringTransaction] = {}
    deleted = 0
    demoted = 0
    touched_accounts: set[str] = set()

    for real in real_transactions:
        recurring_id = real.recurring_transaction_id
        if recurring_id not in definitions:
            definitions[recurring_id] = (
                db.query(RecurringTransaction)
                .filter(RecurringTransaction.id == recurring_id)
                .first()
            )
        recurring = definitions[recurring_id]
        if recurring is None:
            continue

        placeholder = find_placeholder(
            db,
            user_id=user_id,
            account_id=real.account_id,
            recurring_id=recurring_id,
            booked_at=real.booked_at,
            amount=real.amount,
            is_variable_amount=bool(recurring.is_variable_amount),
            window_days=window_days,
        )
        if placeholder is None or placeholder.id == real.id:
            continue

        touched_accounts.add(str(real.account_id))
        if _placeholder_is_untouched(placeholder, recurring):
            db.delete(placeholder)
            deleted += 1
            logger.info(
                "[RECURRING] Deleted placeholder %s superseded by real transaction %s",
                placeholder.id,
                real.id,
            )
        else:
            # The user edited this placeholder. Keep the row so the edit
            # survives, but stop it from double counting.
            placeholder.include_in_analytics = False
            demoted += 1
            logger.info(
                "[RECURRING] Placeholder %s was edited by the user; excluded from analytics "
                "instead of deleted (superseded by %s)",
                placeholder.id,
                real.id,
            )

    if commit and (deleted or demoted):
        db.commit()

    return {"deleted": deleted, "demoted": demoted, "account_ids": sorted(touched_accounts)}
