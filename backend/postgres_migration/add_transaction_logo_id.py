"""
One-off migration: add transactions.logo_id column (FK -> company_logos).

Usage (from backend/):
    python postgres_migration/add_transaction_logo_id.py

Idempotent: safe to re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text

from app.database import db_url


SQL = """
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS logo_id UUID REFERENCES company_logos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_logo ON transactions (logo_id);
"""


def main() -> int:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text(SQL))
    print("OK: transactions.logo_id present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
