"""Celery task for sweeping stale rows from mcp_idempotency_keys.

Same shape as prune_rate_limit_counters, and for the same reason: Postgres
has no TTL, and the table takes one row per keyed MCP write, so without a
sweep it grows for as long as agents keep calling.

24h is the window. A retry that arrives a day after the call it is retrying
is not a retry, and holding the row longer only widens the gap between "this
key is remembered" and "this key means anything".
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from celery_app import celery_app
from app.database import engine

logger = logging.getLogger(__name__)

_MAX_KEY_AGE = timedelta(hours=24)


@celery_app.task
def prune_mcp_idempotency_keys() -> int:
    """Deletes idempotency rows older than 24h. Returns the number deleted."""
    # The cutoff is computed here rather than as `now() - INTERVAL :age`,
    # because INTERVAL takes a literal in Postgres and will not accept a bind
    # parameter. A datetime binds fine.
    cutoff = datetime.now(timezone.utc) - _MAX_KEY_AGE
    with engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM mcp_idempotency_keys WHERE created_at < :cutoff"),
            {"cutoff": cutoff},
        )
        deleted = result.rowcount or 0
    if deleted:
        logger.info("Pruned %d stale mcp_idempotency_keys row(s).", deleted)
    return deleted
