"""
One-off migration: create the merchant_aliases table and seed it from
MerchantExtractor.KNOWN_MERCHANTS.

Usage (from backend/):
    python postgres_migration/add_merchant_aliases_table.py

Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS, seed rows use
ON CONFLICT (pattern) DO NOTHING). New app instances also get this table for
free via Base.metadata.create_all() at startup (see app/main.py); this script
exists for existing deployments and to (re-)run the seed.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text

from app.database import db_url
from app.services.merchant_extractor import MerchantExtractor


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS merchant_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern VARCHAR(255) NOT NULL,
    canonical_name VARCHAR(255) NOT NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    logo_domain VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT merchant_aliases_pattern_unique UNIQUE (pattern)
);
CREATE INDEX IF NOT EXISTS idx_merchant_aliases_pattern ON merchant_aliases (pattern);
"""

SEED_SQL = """
INSERT INTO merchant_aliases (pattern, canonical_name)
VALUES (:pattern, :canonical_name)
ON CONFLICT (pattern) DO NOTHING;
"""


def main() -> int:
    engine = create_engine(db_url)
    with engine.begin() as conn:
        conn.execute(text(CREATE_TABLE_SQL))
        seeded = 0
        for pattern, canonical_name in MerchantExtractor.KNOWN_MERCHANTS.items():
            result = conn.execute(
                text(SEED_SQL), {"pattern": pattern, "canonical_name": canonical_name}
            )
            seeded += result.rowcount
    print(f"OK: merchant_aliases table present, seeded {seeded} new row(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
