-- Postgres-backed fixed-window counters for the backend's IP/identity rate
-- limiter (backend/app/rate_limit.py), replacing Redis INCR/EXPIRE. One row
-- per key (not per key+bucket) -- window_start tracks which bucket the count
-- belongs to, reset via the upsert's CASE rather than a second DELETE/EXPIRE.
-- UNLOGGED: rate-limit state is disposable, skipping WAL avoids write
-- amplification for a table that churns on every rate-limited request.
CREATE UNLOGGED TABLE IF NOT EXISTS "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL DEFAULT 1
);
