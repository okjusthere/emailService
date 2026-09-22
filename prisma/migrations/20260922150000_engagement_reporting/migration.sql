-- Preserve historical unknown tracking coverage; never backfill from today's settings.
ALTER TYPE "SuppressionReason" ADD VALUE 'SOFT_BOUNCE';
ALTER TYPE "SuppressionReason" ADD VALUE 'BOUNCE_REVIEW';

CREATE TABLE "provider_domain_tracking" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "provider_domain_id" TEXT,
  "open_tracking_enabled" BOOLEAN,
  "click_tracking_enabled" BOOLEAN,
  "tracking_domain" TEXT,
  "tracking_verified" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "checked_at" TIMESTAMPTZ(3),
  "last_attempt_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "verified_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "provider_domain_tracking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_domain_tracking_provider_domain_key"
  ON "provider_domain_tracking"("provider", "domain");

ALTER TABLE "campaigns"
  ADD COLUMN "reporting_summary" JSONB,
  ADD COLUMN "stats_computed_at" TIMESTAMPTZ(3);
ALTER TABLE "send_batches" ADD COLUMN "tracking_snapshot" JSONB;
ALTER TABLE "campaign_recipients"
  ADD COLUMN "listing_clicked_at" TIMESTAMPTZ(3),
  ADD COLUMN "click_tracking_enabled" BOOLEAN,
  ADD COLUMN "open_tracking_enabled" BOOLEAN,
  ADD COLUMN "tracking_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN "tracking_revision" TEXT,
  ADD COLUMN "bounce_type" TEXT,
  ADD COLUMN "bounce_sub_type" TEXT,
  ADD COLUMN "bounce_reason" TEXT;
ALTER TABLE "email_events"
  ADD COLUMN "link_purpose" TEXT,
  ADD COLUMN "automation_classification" TEXT;
