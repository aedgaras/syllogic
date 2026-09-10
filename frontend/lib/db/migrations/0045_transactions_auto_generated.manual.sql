-- Transactions materialized by the recurring-transaction beat
-- (tasks/recurring_transaction_tasks.py) are placeholders: they stand in for a
-- charge that has not reached the bank feed yet. Flagging them lets the sync
-- adopt the real row onto the placeholder instead of leaving two rows behind,
-- and lets the UI label the entry as generated.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "auto_generated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_auto_generated" ON "transactions" ("recurring_transaction_id", "booked_at") WHERE "auto_generated";
