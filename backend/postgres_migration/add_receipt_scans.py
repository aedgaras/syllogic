"""
One-off migration: add receipt_scans table and transactions.receipt_scan_id column.

Usage (from backend/):
    python postgres_migration/add_receipt_scans.py

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
CREATE TABLE IF NOT EXISTS receipt_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    file_path TEXT,
    file_path_ciphertext TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    raw_ocr_text TEXT,
    merchant_name VARCHAR(255),
    receipt_total NUMERIC(15, 2),
    receipt_date TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT now(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receipt_scans_user ON receipt_scans (user_id);
CREATE INDEX IF NOT EXISTS idx_receipt_scans_account ON receipt_scans (account_id);

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS receipt_scan_id UUID
        REFERENCES receipt_scans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_receipt_scan ON transactions (receipt_scan_id);
"""


def main() -> int:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text(SQL))
    print("OK: receipt_scans table and transactions.receipt_scan_id present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
