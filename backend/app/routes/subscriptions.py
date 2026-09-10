"""
API routes for subscriptions management.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from uuid import UUID
from decimal import Decimal
import logging

from app.database import get_db
from app.models import RecurringTransaction, Transaction
from app.db_helpers import get_user_id
from app.services.recurring_transaction_generator import generate_due_transactions
from app.services.recurring_transaction_schedule_service import compute_next_due_date
from app.services.text_similarity import TextSimilarity
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared text similarity service
_text_similarity = TextSimilarity()


class GenerateNowResponse(BaseModel):
    """Response for manually materializing the next scheduled occurrence."""

    success: bool
    message: str
    created_count: int
    transaction_ids: List[str]
    next_due_date: Optional[str]


class SkipNextResponse(BaseModel):
    """Response for skipping one scheduled occurrence."""

    success: bool
    message: str
    skipped_date: Optional[str]
    next_due_date: Optional[str]
    auto_generate: bool


class MatchTransactionsResponse(BaseModel):
    """Response for matching transactions to a subscription."""

    success: bool
    message: str
    matched_count: int
    transaction_ids: List[str]


def _amount_close(amount1: Decimal, amount2: Decimal, tolerance_percent: float = 0.05) -> bool:
    """
    Check if two amounts are close within a tolerance percentage.

    Args:
        amount1: First amount
        amount2: Second amount
        tolerance_percent: Tolerance as a percentage (default 5%)

    Returns:
        True if amounts are within tolerance
    """
    if amount1 == 0 or amount2 == 0:
        return False

    # Use absolute values for comparison
    abs_amount1 = abs(float(amount1))
    abs_amount2 = abs(float(amount2))

    # Calculate percentage difference
    diff = abs(abs_amount1 - abs_amount2)
    avg = (abs_amount1 + abs_amount2) / 2

    if avg == 0:
        return False

    percentage_diff = diff / avg
    return percentage_diff <= tolerance_percent


@router.post("/{subscription_id}/match-transactions", response_model=MatchTransactionsResponse)
def match_transactions(
    subscription_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (optional, defaults to system user)"),
    description_similarity_threshold: float = Query(
        0.6, ge=0.0, le=1.0, description="Minimum similarity ratio for description matching"
    ),
    amount_tolerance_percent: float = Query(
        0.05, ge=0.0, le=1.0, description="Maximum percentage difference for amount matching"
    ),
    db: Session = Depends(get_db),
):
    """
    Match transactions to a subscription based on description similarity and amount closeness.

    Args:
        subscription_id: ID of the subscription to match against
        user_id: User ID (optional, defaults to system user)
        description_similarity_threshold: Minimum similarity ratio for description matching (0.0-1.0, default 0.6)
        amount_tolerance_percent: Maximum percentage difference for amount matching (default 5%)
        db: Database session

    Returns:
        MatchTransactionsResponse with matched transaction count and IDs
    """
    try:
        actual_user_id = get_user_id(user_id)

        # Get the subscription
        subscription = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.id == subscription_id,
                RecurringTransaction.user_id == actual_user_id,
            )
            .first()
        )

        if not subscription:
            raise HTTPException(status_code=404, detail="Subscription not found")

        logger.info(
            f"[MATCH] Matching transactions for subscription '{subscription.name}' "
            f"(ID: {subscription_id}, User: {actual_user_id})"
        )

        # Get all transactions for this user that don't already have a recurring_transaction_id
        # or have a different one
        candidate_query = db.query(Transaction).filter(
            Transaction.user_id == actual_user_id,
            or_(
                Transaction.recurring_transaction_id.is_(None),
                Transaction.recurring_transaction_id != subscription_id,
            ),
        )
        if subscription.account_id:
            candidate_query = candidate_query.filter(
                Transaction.account_id == subscription.account_id
            )

        candidate_transactions = candidate_query.all()

        logger.info(f"[MATCH] Found {len(candidate_transactions)} candidate transactions to check")

        # Get subscription fields for matching
        subscription_amount = abs(subscription.amount)  # Use absolute value for comparison

        matched_transactions = []
        matched_ids = []

        for txn in candidate_transactions:
            # Skip if transaction amount is zero
            if txn.amount == 0:
                continue

            txn_amount = abs(txn.amount)  # Use absolute value

            # Check amount similarity first (fast filter)
            if not _amount_close(subscription_amount, txn_amount, amount_tolerance_percent):
                continue

            # Use unified text similarity service
            best_score, match_method = _text_similarity.calculate_match_score(
                subscription_name=subscription.name,
                subscription_merchant=subscription.merchant,
                transaction_description=txn.description,
                transaction_merchant=txn.merchant,
            )

            # Convert score to 0-1 range for comparison with threshold
            normalized_score = best_score / 100.0

            # If similarity meets threshold, consider it a match
            if normalized_score >= description_similarity_threshold:
                matched_transactions.append(txn)
                matched_ids.append(str(txn.id))
                logger.debug(
                    f"[MATCH] Matched transaction {txn.id}: "
                    f"description='{txn.description}', merchant='{txn.merchant}', "
                    f"amount={txn.amount}, score={best_score:.1f}%, method={match_method}"
                )

        # Update matched transactions
        if matched_transactions:
            for txn in matched_transactions:
                txn.recurring_transaction_id = subscription_id

            db.commit()
            logger.info(f"[MATCH] Successfully matched {len(matched_transactions)} transactions")
        else:
            logger.info("[MATCH] No matching transactions found")

        return MatchTransactionsResponse(
            success=True,
            message=f"Matched {len(matched_transactions)} transaction(s) to subscription '{subscription.name}'",
            matched_count=len(matched_transactions),
            transaction_ids=matched_ids,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[MATCH] Error matching transactions: {e}")
        import traceback

        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to match transactions: {str(e)}")


def _load_schedulable(db: Session, subscription_id: UUID, user_id: str) -> RecurringTransaction:
    """Fetch a recurring definition that is eligible for manual scheduling."""
    recurring = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.id == subscription_id,
            RecurringTransaction.user_id == user_id,
        )
        .first()
    )
    if not recurring:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not recurring.next_due_date:
        raise HTTPException(
            status_code=400,
            detail="This subscription has no schedule. Set a next due date first.",
        )
    if not recurring.account_id:
        raise HTTPException(
            status_code=400,
            detail="This subscription has no account. Pick an account before generating transactions.",
        )
    return recurring


@router.post("/{subscription_id}/generate-now", response_model=GenerateNowResponse)
def generate_now(
    subscription_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (optional, defaults to system user)"),
    db: Session = Depends(get_db),
):
    """Materialize the next scheduled occurrence immediately.

    Used to book a recurring entry ahead of its date. A no-op (created_count
    of 0) when a transaction already covers that occurrence.
    """
    actual_user_id = get_user_id(user_id)
    recurring = _load_schedulable(db, subscription_id, actual_user_id)

    if recurring.end_date and recurring.next_due_date > recurring.end_date:
        raise HTTPException(
            status_code=400, detail="This subscription's schedule has already ended."
        )

    result = generate_due_transactions(
        db,
        user_id=actual_user_id,
        recurring_ids=[recurring.id],
        single_occurrence=True,
    )

    db.refresh(recurring)
    created_count = len(result.created)
    return GenerateNowResponse(
        success=True,
        message=(
            f"Created {created_count} transaction(s) for '{recurring.name}'"
            if created_count
            else "That occurrence already has a transaction"
        ),
        created_count=created_count,
        transaction_ids=[str(t.id) for t in result.created],
        next_due_date=recurring.next_due_date.isoformat() if recurring.next_due_date else None,
    )


@router.post("/{subscription_id}/skip-next", response_model=SkipNextResponse)
def skip_next(
    subscription_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (optional, defaults to system user)"),
    db: Session = Depends(get_db),
):
    """Advance the schedule by one period without booking a transaction.

    For the month a subscription is paused, a bill is waived, or the charge
    was already captured by an unlinked transaction.
    """
    actual_user_id = get_user_id(user_id)
    recurring = _load_schedulable(db, subscription_id, actual_user_id)

    skipped = recurring.next_due_date
    recurring.next_due_date = compute_next_due_date(recurring.frequency, skipped)
    if recurring.end_date and recurring.next_due_date > recurring.end_date:
        recurring.auto_generate = False
    db.commit()
    db.refresh(recurring)

    logger.info(
        "[RECURRING] Skipped occurrence %s of definition %s (next: %s)",
        skipped,
        recurring.id,
        recurring.next_due_date,
    )
    return SkipNextResponse(
        success=True,
        message=f"Skipped the {skipped.isoformat()} occurrence of '{recurring.name}'",
        skipped_date=skipped.isoformat(),
        next_due_date=recurring.next_due_date.isoformat() if recurring.next_due_date else None,
        auto_generate=bool(recurring.auto_generate),
    )
