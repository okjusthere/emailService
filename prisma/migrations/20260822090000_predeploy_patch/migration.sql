ALTER TYPE "ContactSourceType" ADD VALUE IF NOT EXISTS 'MLS_AGENT_MATCH';

CREATE TYPE "ListingSource" AS ENUM ('MANUAL', 'ONEKEY');
CREATE TYPE "ListingSourceSyncStatus" AS ENUM ('NOT_SYNCED', 'CURRENT', 'STALE', 'FAILED');
CREATE TYPE "WebhookReconciliationStatus" AS ENUM ('RECEIVED', 'MATCHED', 'RETRY_PENDING', 'PROCESSED', 'DEAD_LETTER');
CREATE TYPE "AiGenerationKind" AS ENUM ('LISTING_COPY', 'CAMPAIGN_COPY');
CREATE TYPE "AiGenerationStatus" AS ENUM ('GENERATED', 'APPLIED', 'REJECTED', 'FAILED');

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RECONCILE_WEBHOOK_EVENT';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ONEKEY_INITIAL_SYNC';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ONEKEY_DELTA_SYNC';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ONEKEY_MEDIA_IMPORT';

ALTER TABLE "listings"
  ADD COLUMN "source" "ListingSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_key" TEXT,
  ADD COLUMN "source_listing_id" TEXT,
  ADD COLUMN "source_system" TEXT,
  ADD COLUMN "source_modified_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_sync_status" "ListingSourceSyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
  ADD COLUMN "source_snapshot" JSONB,
  ADD COLUMN "source_warnings" JSONB;

CREATE UNIQUE INDEX "listings_source_source_key_key" ON "listings"("source", "source_key");

ALTER TABLE "email_events"
  ADD COLUMN "reconciliation_status" "WebhookReconciliationStatus" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "reconciliation_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_reconcile_at" TIMESTAMPTZ(3),
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(3);

UPDATE "email_events"
SET "reconciliation_status" = CASE
  WHEN "processed_at" IS NOT NULL AND "campaign_recipient_id" IS NOT NULL THEN 'PROCESSED'::"WebhookReconciliationStatus"
  WHEN "processed_at" IS NOT NULL THEN 'DEAD_LETTER'::"WebhookReconciliationStatus"
  ELSE 'RECEIVED'::"WebhookReconciliationStatus"
END;

CREATE INDEX "email_events_reconciliation_status_next_reconcile_at_idx"
  ON "email_events"("reconciliation_status", "next_reconcile_at");

ALTER TABLE "test_send_records"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "client_request_id" TEXT;

UPDATE "test_send_records"
SET "idempotency_key" = 'legacy/' || "id"::text,
    "client_request_id" = "id"::text;

ALTER TABLE "test_send_records"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "client_request_id" SET NOT NULL;

CREATE UNIQUE INDEX "test_send_records_idempotency_key_key"
  ON "test_send_records"("idempotency_key");

CREATE TABLE "external_sync_cursors" (
  "provider" TEXT NOT NULL,
  "cursor" TEXT,
  "last_started_at" TIMESTAMPTZ(3),
  "last_succeeded_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "records_synced" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "external_sync_cursors_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "onekey_listing_index" (
  "source_key" TEXT NOT NULL,
  "listing_id" TEXT,
  "normalized_address" TEXT NOT NULL,
  "unparsed_address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state_code" TEXT NOT NULL,
  "postal_code" TEXT NOT NULL,
  "county" TEXT,
  "standard_status" TEXT,
  "property_type" TEXT,
  "property_sub_type" TEXT,
  "list_price" DECIMAL(14,2),
  "bedrooms_total" INTEGER,
  "bathrooms_total_integer" INTEGER,
  "living_area" DECIMAL(14,2),
  "year_built" INTEGER,
  "public_remarks" TEXT,
  "list_agent_full_name" TEXT,
  "list_office_name" TEXT,
  "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source_modified_at" TIMESTAMPTZ(3),
  "source_snapshot" JSONB NOT NULL,
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "onekey_listing_index_pkey" PRIMARY KEY ("source_key")
);

CREATE UNIQUE INDEX "onekey_listing_index_listing_id_key" ON "onekey_listing_index"("listing_id");
CREATE INDEX "onekey_listing_index_normalized_address_idx" ON "onekey_listing_index"("normalized_address");
CREATE INDEX "onekey_listing_index_postal_code_standard_status_idx" ON "onekey_listing_index"("postal_code", "standard_status");
CREATE INDEX "onekey_listing_index_source_modified_at_idx" ON "onekey_listing_index"("source_modified_at");

CREATE TABLE "ai_generations" (
  "id" UUID NOT NULL,
  "kind" "AiGenerationKind" NOT NULL,
  "status" "AiGenerationStatus" NOT NULL DEFAULT 'GENERATED',
  "listing_id" UUID,
  "campaign_id" UUID,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "input_facts_hash" TEXT NOT NULL,
  "proposal" JSONB NOT NULL,
  "applied_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_generations_target_check" CHECK (("listing_id" IS NOT NULL) <> ("campaign_id" IS NOT NULL))
);

CREATE INDEX "ai_generations_listing_id_created_at_idx" ON "ai_generations"("listing_id", "created_at");
CREATE INDEX "ai_generations_campaign_id_created_at_idx" ON "ai_generations"("campaign_id", "created_at");
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "manual_review_resolutions" (
  "id" UUID NOT NULL,
  "send_batch_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "provider_email_id" TEXT,
  "quota_released" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manual_review_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manual_review_resolutions_send_batch_id_created_at_idx" ON "manual_review_resolutions"("send_batch_id", "created_at");
ALTER TABLE "manual_review_resolutions" ADD CONSTRAINT "manual_review_resolutions_send_batch_id_fkey" FOREIGN KEY ("send_batch_id") REFERENCES "send_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_review_resolutions" ADD CONSTRAINT "manual_review_resolutions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
