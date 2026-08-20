-- Recurring transactions: support subscriptions whose amount changes each
-- cycle (e.g. usage-based utility bills). "amount" becomes an estimated/
-- typical value when is_variable is true, used for budgeting math and
-- display; matching logic relaxes amount tolerance for these rows.
ALTER TABLE "recurring_transactions" ADD COLUMN IF NOT EXISTS "is_variable_amount" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_suggestions" ADD COLUMN IF NOT EXISTS "is_variable_amount" boolean DEFAULT false NOT NULL;
