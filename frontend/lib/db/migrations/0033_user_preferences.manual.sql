-- Add per-user preference columns to users table.
-- hide_balances: mask balance/net-worth amounts across the app.
-- tutorials_enabled: migrated from client-only localStorage to DB-backed storage.
-- Hand-authored; applied via scripts/migrate.js (.manual.sql runner).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "hide_balances" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tutorials_enabled" boolean DEFAULT true;
