-- Composite indexes matching the dominant transactions access pattern: one
-- user's transactions, newest first, optionally narrowed by account or
-- category.
CREATE INDEX IF NOT EXISTS "idx_transactions_user_booked_at" ON "transactions" ("user_id", "booked_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_user_account_booked_at" ON "transactions" ("user_id", "account_id", "booked_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_user_category_booked_at" ON "transactions" ("user_id", "category_id", "booked_at" DESC);
