-- BetterAuth database-backed rate limit storage. Without this table, rate
-- limiting falls back to an in-memory store that resets on every restart
-- and isn't shared across instances.
CREATE TABLE IF NOT EXISTS "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);
