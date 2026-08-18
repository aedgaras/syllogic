-- Recurring transactions: add schedule fields so a recurring definition can
-- auto-materialize real transactions (next_due_date/end_date/auto_generate),
-- instead of only acting as a label for matching existing transactions.
ALTER TABLE "recurring_transactions" ADD COLUMN IF NOT EXISTS "next_due_date" date;
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN IF NOT EXISTS "end_date" date;
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN IF NOT EXISTS "auto_generate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recurring_transactions_next_due" ON "recurring_transactions" ("next_due_date");
