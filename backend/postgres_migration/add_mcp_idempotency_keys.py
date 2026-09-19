"""
One-off migration: create the mcp_idempotency_keys table.

Usage (from backend/):
    python postgres_migration/add_mcp_idempotency_keys.py

Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS).

A table rather than a key in the rate-limit store, because these rows get
looked at by a human: when a duplicate budget turns up, the question is
"which call created it, and was there a retry", and that is much easier to
answer against SQL than against an opaque counter. The rows are swept after
24h by tasks.mcp_idempotency_tasks.prune_mcp_idempotency_keys.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text

from app.database import db_url


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS mcp_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mcp_idempotency_unique UNIQUE (user_id, tool_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_created
    ON mcp_idempotency_keys (created_at);
"""


def main() -> int:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text(CREATE_TABLE_SQL))
    print("OK: mcp_idempotency_keys table present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
