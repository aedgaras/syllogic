-- Add default_account_id to users: the account preselected when adding a
-- new transaction. Nullable FK to accounts, cleared automatically if the
-- referenced account is deleted.
-- Hand-authored; applied via scripts/migrate.js (.manual.sql runner).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "default_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;
