-- Trigram indexes for MCP transaction search.
--
-- Every match_mode the MCP server offers is an unanchored pattern over
-- description/merchant: ILIKE '%term%' for "contains", and a case-insensitive
-- \y-bounded regex for "word". A btree index (idx_transactions_merchant) can
-- serve none of those, so each search was a sequential scan over the user's
-- whole transaction history. GIN + gin_trgm_ops is the index type Postgres can
-- actually use for both operators.
--
-- pg_trgm has been a trusted extension since Postgres 13, so the database
-- owner can install it without superuser. Where that isn't true, or where the
-- contrib package simply isn't installed, the DO block below warns and moves
-- on: search keeps working exactly as before, just without the index. A
-- missing optimisation must not take down a deploy.
DO $$
BEGIN
	EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
EXCEPTION
	WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
		RAISE WARNING 'Could not create the pg_trgm extension (%). Transaction search will fall back to sequential scans; install it manually as a superuser to enable the trigram indexes.', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
		EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_transactions_description_trgm" ON "transactions" USING gin ("description" gin_trgm_ops)';
		EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_transactions_merchant_trgm" ON "transactions" USING gin ("merchant" gin_trgm_ops)';
	END IF;
END $$;
