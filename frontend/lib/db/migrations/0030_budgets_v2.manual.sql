-- Budgets v2: per-category sub-budgets + stable system category identifiers
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "sub_limit" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "system_key" varchar(50);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_categories_user_system_key" ON "categories" ("user_id", "system_key");
