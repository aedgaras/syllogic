"""Celery task for pruning stale rows from rate_limit_counters.

Postgres has no built-in TTL (unlike the Redis EXPIRE this table replaced --
see app/rate_limit.py), so stale keys are swept periodically instead of
expiring on their own. The table has one row per key ever seen, so without
this it grows unbounded as new IPs/identities show up.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import text

from celery_app import celery_app
from app.database import engine

logger = logging.getLogger(__name__)

# Generous relative to any window_seconds actually in use (60s IP limit,
# hourly LLM limit) -- this only needs to keep the table small, not track
# any single caller's window precisely.
_MAX_COUNTER_AGE_SECONDS = 24 * 60 * 60


@celery_app.task
def prune_rate_limit_counters() -> int:
    """Deletes counters whose window is older than _MAX_COUNTER_AGE_SECONDS.
    Returns the number of rows deleted."""
    cutoff = int(time.time()) - _MAX_COUNTER_AGE_SECONDS
    with engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM rate_limit_counters WHERE window_start < :cutoff"),
            {"cutoff": cutoff},
        )
        deleted = result.rowcount or 0
    if deleted:
        logger.info("Pruned %d stale rate_limit_counters row(s).", deleted)
    return deleted
