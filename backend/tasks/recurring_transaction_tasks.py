"""Celery task that materializes real transactions from due recurring definitions."""

from __future__ import annotations

import logging

from celery_app import celery_app

from app.database import SessionLocal
from app.services.recurring_transaction_generator import generate_due_transactions

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.recurring_transaction_tasks.check_due_recurring_transactions")
def check_due_recurring_transactions() -> dict:
    db = SessionLocal()
    try:
        result = generate_due_transactions(db)
        return {
            "created": len(result.created),
            "skipped_existing": result.skipped_existing,
            "definitions_touched": result.definitions_touched,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
