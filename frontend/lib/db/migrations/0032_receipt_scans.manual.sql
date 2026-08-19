CREATE TABLE IF NOT EXISTS "receipt_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
	"file_path" text,
	"file_path_ciphertext" text,
	"status" varchar(20) DEFAULT 'pending',
	"raw_ocr_text" text,
	"merchant_name" varchar(255),
	"receipt_total" numeric(15, 2),
	"receipt_date" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receipt_scans_user" ON "receipt_scans" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_receipt_scans_account" ON "receipt_scans" ("account_id");
--> statement-breakpoint
ALTER TABLE "transactions"
	ADD COLUMN IF NOT EXISTS "receipt_scan_id" uuid REFERENCES "receipt_scans"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_receipt_scan" ON "transactions" ("receipt_scan_id");
