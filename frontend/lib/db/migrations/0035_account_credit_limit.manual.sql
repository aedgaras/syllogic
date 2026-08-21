-- Credit card accounts: optional credit limit, used to display available
-- credit alongside the outstanding (negative) balance.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(15,2);
