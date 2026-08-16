CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(255) PRIMARY KEY NOT NULL,
  "value_encrypted" text,
  "updated_by_user_id" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_updated_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "app_settings"
      ADD CONSTRAINT "app_settings_updated_by_user_id_users_id_fk"
      FOREIGN KEY ("updated_by_user_id")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;
