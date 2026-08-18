-- Budgets feature: spending limits across one or more categories
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "currency" char(3) DEFAULT 'EUR',
  "period" varchar(20) DEFAULT 'monthly' NOT NULL,
  "start_date" date,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_categories" (
  "budget_id" uuid NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "budget_categories_pkey" PRIMARY KEY ("budget_id", "category_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_budgets_user" ON "budgets" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_budgets_user_active" ON "budgets" ("user_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_budget_categories_category" ON "budget_categories" ("category_id");
