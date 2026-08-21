-- One-time sweep converting every `timestamp` column to `timestamptz`.
-- Naive timestamps were always written/read as UTC by the app; this makes
-- that explicit at the database level so it matches the application code,
-- which now uses datetime.now(timezone.utc) / DateTime(timezone=True)
-- throughout instead of naive datetime.utcnow(). Existing values are
-- reinterpreted as UTC (not shifted) via `AT TIME ZONE 'UTC'`.
--
-- Guarded on the column's current type (not IF NOT EXISTS -- ALTER COLUMN
-- TYPE has no such clause) so re-running this file, which the migrator does
-- on every deploy, doesn't force a full table rewrite every time.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'ban_expires') = 'timestamp without time zone' THEN
    ALTER TABLE "users" ALTER COLUMN "ban_expires" TYPE timestamptz USING "ban_expires" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'onboarding_completed_at') = 'timestamp without time zone' THEN
    ALTER TABLE "users" ALTER COLUMN "onboarding_completed_at" TYPE timestamptz USING "onboarding_completed_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "users" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'sessions' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "sessions" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'sessions' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "sessions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'sessions' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "sessions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'auth_accounts' AND column_name = 'access_token_expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "auth_accounts" ALTER COLUMN "access_token_expires_at" TYPE timestamptz USING "access_token_expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'auth_accounts' AND column_name = 'refresh_token_expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "auth_accounts" ALTER COLUMN "refresh_token_expires_at" TYPE timestamptz USING "refresh_token_expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'auth_accounts' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "auth_accounts" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'auth_accounts' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "auth_accounts" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'verification_tokens' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "verification_tokens" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'verification_tokens' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "verification_tokens" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'verification_tokens' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "verification_tokens" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_client' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_client" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_client' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_client" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_access_token' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_access_token" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_access_token' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_access_token" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_refresh_token' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_refresh_token" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_refresh_token' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_refresh_token" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_refresh_token' AND column_name = 'revoked') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_refresh_token" ALTER COLUMN "revoked" TYPE timestamptz USING "revoked" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_refresh_token' AND column_name = 'auth_time') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_refresh_token" ALTER COLUMN "auth_time" TYPE timestamptz USING "auth_time" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_consent' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_consent" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'oauth_consent' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "oauth_consent" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'jwks' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "jwks" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'jwks' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "jwks" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'last_used_at') = 'timestamp without time zone' THEN
    ALTER TABLE "api_keys" ALTER COLUMN "last_used_at" TYPE timestamptz USING "last_used_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "api_keys" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "api_keys" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'app_settings' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "app_settings" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'app_settings' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "app_settings" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'last_synced_at') = 'timestamp without time zone' THEN
    ALTER TABLE "accounts" ALTER COLUMN "last_synced_at" TYPE timestamptz USING "last_synced_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "accounts" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "accounts" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'consent_expires_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "consent_expires_at" TYPE timestamptz USING "consent_expires_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'consent_notified_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "consent_notified_at" TYPE timestamptz USING "consent_notified_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'last_synced_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "last_synced_at" TYPE timestamptz USING "last_synced_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'sync_started_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "sync_started_at" TYPE timestamptz USING "sync_started_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'bank_connections' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "bank_connections" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'categories' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "categories" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'csv_imports' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "csv_imports" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'csv_imports' AND column_name = 'completed_at') = 'timestamp without time zone' THEN
    ALTER TABLE "csv_imports" ALTER COLUMN "completed_at" TYPE timestamptz USING "completed_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'booked_at') = 'timestamp without time zone' THEN
    ALTER TABLE "transactions" ALTER COLUMN "booked_at" TYPE timestamptz USING "booked_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "transactions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "transactions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'internal_transfers' AND column_name = 'detected_at') = 'timestamp without time zone' THEN
    ALTER TABLE "internal_transfers" ALTER COLUMN "detected_at" TYPE timestamptz USING "detected_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'internal_transfers' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "internal_transfers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'recurring_transactions' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "recurring_transactions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'recurring_transactions' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "recurring_transactions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'budgets' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "budgets" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'budgets' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "budgets" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'budget_categories' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "budget_categories" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'categorization_rules' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "categorization_rules" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'properties' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "properties" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'properties' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "properties" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'vehicles' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "vehicles" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'vehicles' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "vehicles" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'exchange_rates' AND column_name = 'date') = 'timestamp without time zone' THEN
    ALTER TABLE "exchange_rates" ALTER COLUMN "date" TYPE timestamptz USING "date" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'exchange_rates' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "exchange_rates" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'exchange_rates' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "exchange_rates" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'subscription_suggestions' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "subscription_suggestions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'subscription_suggestions' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "subscription_suggestions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'account_balances' AND column_name = 'date') = 'timestamp without time zone' THEN
    ALTER TABLE "account_balances" ALTER COLUMN "date" TYPE timestamptz USING "date" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'account_balances' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "account_balances" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'account_balances' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "account_balances" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'transaction_links' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "transaction_links" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'company_logos' AND column_name = 'last_checked_at') = 'timestamp without time zone' THEN
    ALTER TABLE "company_logos" ALTER COLUMN "last_checked_at" TYPE timestamptz USING "last_checked_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'company_logos' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "company_logos" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'company_logos' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "company_logos" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'broker_connections' AND column_name = 'last_sync_at') = 'timestamp without time zone' THEN
    ALTER TABLE "broker_connections" ALTER COLUMN "last_sync_at" TYPE timestamptz USING "last_sync_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'broker_connections' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "broker_connections" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'broker_connections' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "broker_connections" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'holdings' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "holdings" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'holdings' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "holdings" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'people' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "people" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'people' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "people" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'account_owners' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "account_owners" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'property_owners' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "property_owners" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'vehicle_owners' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "vehicle_owners" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'reports' AND column_name = 'next_run_at') = 'timestamp without time zone' THEN
    ALTER TABLE "reports" ALTER COLUMN "next_run_at" TYPE timestamptz USING "next_run_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'reports' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "reports" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'reports' AND column_name = 'updated_at') = 'timestamp without time zone' THEN
    ALTER TABLE "reports" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'report_runs' AND column_name = 'scheduled_for') = 'timestamp without time zone' THEN
    ALTER TABLE "report_runs" ALTER COLUMN "scheduled_for" TYPE timestamptz USING "scheduled_for" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'report_runs' AND column_name = 'started_at') = 'timestamp without time zone' THEN
    ALTER TABLE "report_runs" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'report_runs' AND column_name = 'finished_at') = 'timestamp without time zone' THEN
    ALTER TABLE "report_runs" ALTER COLUMN "finished_at" TYPE timestamptz USING "finished_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'report_runs' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE "report_runs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
  END IF;
END $$;
