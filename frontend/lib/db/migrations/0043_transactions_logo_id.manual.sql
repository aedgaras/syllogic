-- Add logo_id column to transactions table (FK -> company_logos).
-- Mirrors accounts.logo_id / recurring_transactions.logo_id. The Python
-- backend applies the same column via postgres_migration/add_transaction_logo_id.py;
-- both are idempotent so it doesn't matter which runs first.
-- Hand-authored; applied via scripts/migrate.js (.manual.sql runner).

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "logo_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "transactions" ADD CONSTRAINT "transactions_logo_id_company_logos_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."company_logos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_logo" ON "transactions" USING btree ("logo_id");
