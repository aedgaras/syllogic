-- accounts.balance_current was part of the very first migration but was
-- superseded by functional_balance before schema.ts (or app/models.py)
-- ever tracked it -- an orphaned column nothing reads or writes. Dropping
-- it so the schema-drift check (scripts/check_schema_drift.py) has a clean
-- baseline instead of permanently flagging known-dead cruft.
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "balance_current";
