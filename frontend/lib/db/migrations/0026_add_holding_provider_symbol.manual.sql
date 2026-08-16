ALTER TABLE "holdings"
  ADD COLUMN IF NOT EXISTS "provider_symbol" text;
