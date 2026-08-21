-- Index the api_keys lookup path so an unrecognized prefix can be rejected
-- with a cheap indexed lookup instead of a full-table scan.
CREATE INDEX IF NOT EXISTS "idx_api_keys_prefix" ON "api_keys" ("key_prefix");
