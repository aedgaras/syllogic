-- broker_trades has no reliable intra-day ordering column: `trade_date` is
-- date-only, and `id` (gen_random_uuid, v4) is not time-ordered. Multiple
-- same-day trades (e.g. a buy and a sell recorded minutes apart) sort
-- arbitrarily without this, corrupting running-quantity history.
ALTER TABLE "broker_trades" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();
