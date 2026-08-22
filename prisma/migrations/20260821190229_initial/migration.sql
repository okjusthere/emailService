-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MARKETER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('BUYER', 'SELLER', 'INVESTOR', 'BROKER', 'TENANT', 'LANDLORD', 'DEVELOPER', 'LENDER', 'ATTORNEY', 'VENDOR', 'PAST_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactSourceType" AS ENUM ('PAST_CLIENT', 'OPEN_HOUSE', 'WEBSITE', 'BROKER_RELATIONSHIP', 'EVENT', 'CRM_IMPORT', 'MANUAL', 'REFERRAL', 'LEGACY_EMAIL_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "PermissionBasis" AS ENUM ('OPT_IN', 'EXISTING_RELATIONSHIP', 'BUSINESS_CONTACT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('REGION', 'STATE', 'COUNTY', 'CITY', 'NEIGHBORHOOD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNDER_CONTRACT', 'SOLD', 'LEASED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('FOR_SALE', 'FOR_LEASE', 'SALE_OR_LEASE');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('OFFICE', 'RETAIL', 'INDUSTRIAL', 'MULTIFAMILY', 'LAND', 'MIXED_USE', 'HOSPITALITY', 'SPECIAL_PURPOSE', 'BUSINESS', 'RESIDENTIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ListingAssetKind" AS ENUM ('HERO', 'GALLERY', 'FLOORPLAN', 'BROCHURE', 'LOGO', 'OTHER');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBE', 'HARD_BOUNCE', 'COMPLAINT', 'PROVIDER_SUPPRESSED', 'LEGACY_BOUNCE_REVIEW', 'INVALID_ADDRESS', 'MANUAL');

-- CreateEnum
CREATE TYPE "SuppressionSource" AS ENUM ('USER', 'RESEND', 'ADMIN', 'IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SenderVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('LISTING', 'ANNOUNCEMENT', 'LEGACY_ARCHIVE');

-- CreateEnum
CREATE TYPE "CampaignTemplateKey" AS ENUM ('LISTING_BRANDED', 'BROKER_PERSONAL');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'SNAPSHOTTING', 'SCHEDULED', 'QUEUED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecipientSendState" AS ENUM ('PENDING', 'RESERVED', 'SENDING', 'ACCEPTED', 'TEMPORARY_FAILED', 'PERMANENT_FAILED', 'SUPPRESSED', 'CANCELLED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "RecipientDeliveryState" AS ENUM ('UNKNOWN', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'PROVIDER_SUPPRESSED');

-- CreateEnum
CREATE TYPE "SendBatchStatus" AS ENUM ('PREPARING', 'SUBMITTING', 'ACCEPTED', 'PARTIAL', 'TEMPORARY_FAILED', 'PERMANENT_FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "SendAttemptOutcome" AS ENUM ('STARTED', 'ACCEPTED', 'PARTIAL', 'TEMPORARY_FAILED', 'PERMANENT_FAILED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SNAPSHOT_CAMPAIGN', 'DISPATCH_CAMPAIGN', 'PROCESS_WEBHOOK_EVENT', 'RECOMPUTE_CAMPAIGN_STATS', 'IMPORT_CONTACTS', 'CLEANUP_EXPIRED_DATA');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'INVALID');

-- CreateEnum
CREATE TYPE "UnsubscribeSource" AS ENUM ('VISIBLE_LINK', 'ONE_CLICK', 'ADMIN', 'PROVIDER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "entra_object_id" TEXT,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "phone" TEXT,
    "title" TEXT,
    "license_number" TEXT,
    "headshot_url" TEXT,
    "signature_html" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT,
    "company" TEXT,
    "job_title" TEXT,
    "phone" TEXT,
    "contact_type" "ContactType" NOT NULL DEFAULT 'OTHER',
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_type" "ContactSourceType" NOT NULL,
    "source_detail" TEXT,
    "source_reference" TEXT,
    "permission_basis" "PermissionBasis" NOT NULL DEFAULT 'UNKNOWN',
    "permission_captured_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "custom_fields" JSONB,
    "last_sent_at" TIMESTAMPTZ(3),
    "last_engaged_at" TIMESTAMPTZ(3),
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contact_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "MarketType" NOT NULL,
    "parent_id" UUID,
    "state_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_markets" (
    "contact_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,

    CONSTRAINT "contact_markets_pkey" PRIMARY KEY ("contact_id","market_id")
);

-- CreateTable
CREATE TABLE "property_interests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "property_type" "PropertyType",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_property_interests" (
    "contact_id" UUID NOT NULL,
    "property_interest_id" UUID NOT NULL,

    CONSTRAINT "contact_property_interests_pkey" PRIMARY KEY ("contact_id","property_interest_id")
);

-- CreateTable
CREATE TABLE "suppressions" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" "SuppressionSource" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "details" JSONB,
    "campaign_id" UUID,
    "campaign_recipient_id" UUID,
    "suppressed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "released_by_user_id" UUID,
    "release_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "internal_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "transaction_type" "TransactionType" NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "county" TEXT,
    "market_text" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "asking_price" DECIMAL(14,2),
    "asking_rent_text" TEXT,
    "building_sq_ft" INTEGER,
    "lot_sq_ft" DECIMAL(14,2),
    "unit_count" INTEGER,
    "clear_height_ft" DECIMAL(6,2),
    "loading_docks" INTEGER,
    "drive_in_doors" INTEGER,
    "parking_spaces" INTEGER,
    "cap_rate" DECIMAL(7,4),
    "zoning" TEXT,
    "year_built" INTEGER,
    "short_description" TEXT,
    "long_description" TEXT,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listing_url" TEXT,
    "brochure_url" TEXT,
    "virtual_tour_url" TEXT,
    "external_id" TEXT,
    "mls_id" TEXT,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "price_upon_request" BOOLEAN NOT NULL DEFAULT false,
    "facts" JSONB,
    "agent_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_assets" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "kind" "ListingAssetKind" NOT NULL,
    "blob_name" TEXT NOT NULL,
    "public_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_email_safe" BOOLEAN NOT NULL DEFAULT false,
    "original_file_name" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "from_name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "from_email_normalized" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "verification_status" "SenderVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMPTZ(3),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fixed_reply_to_email" TEXT,
    "daily_limit" INTEGER NOT NULL DEFAULT 500,
    "batch_size" INTEGER NOT NULL DEFAULT 50,
    "min_batch_interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "send_window_start" TEXT NOT NULL DEFAULT '08:00',
    "send_window_end" TEXT NOT NULL DEFAULT '18:00',
    "allowed_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "warmup_enabled" BOOLEAN NOT NULL DEFAULT false,
    "warmup_start_date" DATE,
    "warmup_schedule" JSONB,
    "open_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "click_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sender_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_audiences" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filter" JSONB NOT NULL,
    "last_estimated_count" INTEGER,
    "last_estimated_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'LISTING',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "listing_id" UUID,
    "sender_profile_id" UUID NOT NULL,
    "reply_to_agent_id" UUID,
    "saved_audience_id" UUID,
    "template_key" "CampaignTemplateKey" NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "intro_html" TEXT,
    "intro_text" TEXT,
    "cta_label" TEXT NOT NULL DEFAULT 'View Listing',
    "cta_url" TEXT,
    "audience_filter" JSONB NOT NULL,
    "audience_snapshot_summary" JSONB,
    "content_snapshot" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_successful_test_at" TIMESTAMPTZ(3),
    "last_tested_version" INTEGER,
    "target_count" INTEGER NOT NULL DEFAULT 0,
    "eligible_count" INTEGER NOT NULL DEFAULT 0,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_count" INTEGER NOT NULL DEFAULT 0,
    "bounced_count" INTEGER NOT NULL DEFAULT 0,
    "complained_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT,
    "company" TEXT,
    "personalization" JSONB,
    "unsubscribe_token_hash" TEXT NOT NULL,
    "send_state" "RecipientSendState" NOT NULL DEFAULT 'PENDING',
    "delivery_state" "RecipientDeliveryState" NOT NULL DEFAULT 'UNKNOWN',
    "suppression_reason" "SuppressionReason",
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "next_attempt_at" TIMESTAMPTZ(3),
    "claim_token" TEXT,
    "claimed_at" TIMESTAMPTZ(3),
    "claim_expires_at" TIMESTAMPTZ(3),
    "send_batch_id" UUID,
    "resend_email_id" TEXT,
    "accepted_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "clicked_at" TIMESTAMPTZ(3),
    "bounced_at" TIMESTAMPTZ(3),
    "complained_at" TIMESTAMPTZ(3),
    "provider_suppressed_at" TIMESTAMPTZ(3),
    "last_provider_event_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_batches" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "sender_profile_id" UUID NOT NULL,
    "status" "SendBatchStatus" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "recipient_count" INTEGER NOT NULL,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "idempotency_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "send_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_attempts" (
    "id" UUID NOT NULL,
    "send_batch_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" "SendAttemptOutcome" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "http_status" INTEGER,
    "retry_after_seconds" INTEGER,
    "provider_request_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "response_summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "send_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_email_id" TEXT,
    "recipient_email" TEXT,
    "event_created_at" TIMESTAMPTZ(3) NOT NULL,
    "campaign_recipient_id" UUID,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "processing_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_daily_usage" (
    "id" UUID NOT NULL,
    "sender_profile_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "released_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sender_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "unique_key" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "lock_expires_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_imports" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "blob_name" TEXT,
    "source_metadata" JSONB NOT NULL,
    "mapping" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "error_report_url" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_import_rows" (
    "id" UUID NOT NULL,
    "contact_import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "email_normalized" TEXT,
    "raw_email" TEXT,
    "outcome" "ImportRowOutcome" NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unsubscribe_events" (
    "id" UUID NOT NULL,
    "campaign_recipient_id" UUID,
    "email_normalized" TEXT NOT NULL,
    "source" "UnsubscribeSource" NOT NULL,
    "request_metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unsubscribe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "masked_ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "test_send_records" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "campaign_version" INTEGER NOT NULL,
    "recipient_masked" TEXT NOT NULL,
    "template_version" TEXT NOT NULL,
    "provider_email_id" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_send_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_entra_object_id_key" ON "users"("entra_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "agents_user_id_key" ON "agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_normalized_key" ON "agents"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_email_normalized_key" ON "contacts"("email_normalized");

-- CreateIndex
CREATE INDEX "contacts_status_contact_type_idx" ON "contacts"("status", "contact_type");

-- CreateIndex
CREATE INDEX "contacts_last_engaged_at_idx" ON "contacts"("last_engaged_at");

-- CreateIndex
CREATE INDEX "contacts_source_type_idx" ON "contacts"("source_type");

-- CreateIndex
CREATE INDEX "contacts_created_at_idx" ON "contacts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_normalized_name_key" ON "tags"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "markets_slug_key" ON "markets"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "property_interests_slug_key" ON "property_interests"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_email_normalized_key" ON "suppressions"("email_normalized");

-- CreateIndex
CREATE INDEX "suppressions_is_active_reason_idx" ON "suppressions"("is_active", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "listings_slug_key" ON "listings"("slug");

-- CreateIndex
CREATE INDEX "listings_status_property_type_idx" ON "listings"("status", "property_type");

-- CreateIndex
CREATE INDEX "listings_city_state_code_idx" ON "listings"("city", "state_code");

-- CreateIndex
CREATE INDEX "listings_agent_id_idx" ON "listings"("agent_id");

-- CreateIndex
CREATE INDEX "listings_created_at_idx" ON "listings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listing_assets_blob_name_key" ON "listing_assets"("blob_name");

-- CreateIndex
CREATE INDEX "listing_assets_listing_id_kind_sort_order_idx" ON "listing_assets"("listing_id", "kind", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "sender_profiles_from_email_normalized_key" ON "sender_profiles"("from_email_normalized");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "campaigns_listing_id_idx" ON "campaigns"("listing_id");

-- CreateIndex
CREATE INDEX "campaigns_created_at_idx" ON "campaigns"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_unsubscribe_token_hash_key" ON "campaign_recipients"("unsubscribe_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_resend_email_id_key" ON "campaign_recipients"("resend_email_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_send_state_next_attempt_at_idx" ON "campaign_recipients"("campaign_id", "send_state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_email_normalized_idx" ON "campaign_recipients"("email_normalized");

-- CreateIndex
CREATE INDEX "campaign_recipients_send_batch_id_idx" ON "campaign_recipients"("send_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_email_normalized_key" ON "campaign_recipients"("campaign_id", "email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "send_batches_idempotency_key_key" ON "send_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "send_batches_campaign_id_status_idx" ON "send_batches"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "send_batches_status_idx" ON "send_batches"("status");

-- CreateIndex
CREATE INDEX "send_attempts_send_batch_id_started_at_idx" ON "send_attempts"("send_batch_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "send_attempts_send_batch_id_attempt_number_key" ON "send_attempts"("send_batch_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "email_events_webhook_id_key" ON "email_events"("webhook_id");

-- CreateIndex
CREATE INDEX "email_events_provider_email_id_idx" ON "email_events"("provider_email_id");

-- CreateIndex
CREATE INDEX "email_events_campaign_recipient_id_event_created_at_idx" ON "email_events"("campaign_recipient_id", "event_created_at");

-- CreateIndex
CREATE INDEX "email_events_processed_at_created_at_idx" ON "email_events"("processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sender_daily_usage_sender_profile_id_local_date_key" ON "sender_daily_usage"("sender_profile_id", "local_date");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_unique_key_key" ON "jobs"("unique_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "jobs_lock_expires_at_idx" ON "jobs"("lock_expires_at");

-- CreateIndex
CREATE INDEX "contact_tags_tag_id_contact_id_idx" ON "contact_tags"("tag_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_markets_market_id_contact_id_idx" ON "contact_markets"("market_id", "contact_id");

-- CreateIndex
CREATE INDEX "contact_property_interests_property_interest_id_contact_id_idx" ON "contact_property_interests"("property_interest_id", "contact_id");

-- CreateIndex
CREATE INDEX "campaigns_started_at_idx" ON "campaigns"("started_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_accepted_at_idx" ON "campaign_recipients"("accepted_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_delivered_at_idx" ON "campaign_recipients"("delivered_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_clicked_at_idx" ON "campaign_recipients"("clicked_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_import_rows_contact_import_id_row_number_key" ON "contact_import_rows"("contact_import_id", "row_number");

-- CreateIndex
CREATE INDEX "contact_import_rows_contact_import_id_outcome_idx" ON "contact_import_rows"("contact_import_id", "outcome");

-- CreateIndex
CREATE INDEX "unsubscribe_events_email_normalized_created_at_idx" ON "unsubscribe_events"("email_normalized", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "test_send_records_campaign_id_campaign_version_created_at_idx" ON "test_send_records"("campaign_id", "campaign_version", "created_at");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_markets" ADD CONSTRAINT "contact_markets_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_markets" ADD CONSTRAINT "contact_markets_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_interests" ADD CONSTRAINT "contact_property_interests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_property_interests" ADD CONSTRAINT "contact_property_interests_property_interest_id_fkey" FOREIGN KEY ("property_interest_id") REFERENCES "property_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_assets" ADD CONSTRAINT "listing_assets_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_audiences" ADD CONSTRAINT "saved_audiences_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_audiences" ADD CONSTRAINT "saved_audiences_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_profile_id_fkey" FOREIGN KEY ("sender_profile_id") REFERENCES "sender_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_reply_to_agent_id_fkey" FOREIGN KEY ("reply_to_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_saved_audience_id_fkey" FOREIGN KEY ("saved_audience_id") REFERENCES "saved_audiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_send_batch_id_fkey" FOREIGN KEY ("send_batch_id") REFERENCES "send_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_batches" ADD CONSTRAINT "send_batches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_batches" ADD CONSTRAINT "send_batches_sender_profile_id_fkey" FOREIGN KEY ("sender_profile_id") REFERENCES "sender_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_send_batch_id_fkey" FOREIGN KEY ("send_batch_id") REFERENCES "send_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_campaign_recipient_id_fkey" FOREIGN KEY ("campaign_recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sender_daily_usage" ADD CONSTRAINT "sender_daily_usage_sender_profile_id_fkey" FOREIGN KEY ("sender_profile_id") REFERENCES "sender_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_contact_import_id_fkey" FOREIGN KEY ("contact_import_id") REFERENCES "contact_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unsubscribe_events" ADD CONSTRAINT "unsubscribe_events_campaign_recipient_id_fkey" FOREIGN KEY ("campaign_recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_send_records" ADD CONSTRAINT "test_send_records_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_send_records" ADD CONSTRAINT "test_send_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that must remain true even for operational SQL or future clients.
ALTER TABLE "sender_profiles"
  ADD CONSTRAINT "sender_profiles_daily_limit_positive" CHECK ("daily_limit" > 0),
  ADD CONSTRAINT "sender_profiles_batch_size_range" CHECK ("batch_size" BETWEEN 1 AND 100),
  ADD CONSTRAINT "sender_profiles_batch_interval_nonnegative" CHECK ("min_batch_interval_seconds" >= 0);

CREATE UNIQUE INDEX "sender_profiles_one_default_idx"
  ON "sender_profiles" (("is_default"))
  WHERE "is_default" = true;

ALTER TABLE "sender_daily_usage"
  ADD CONSTRAINT "sender_daily_usage_counts_nonnegative" CHECK (
    "reserved_count" >= 0 AND "accepted_count" >= 0 AND "released_count" >= 0
  );

ALTER TABLE "send_batches"
  ADD CONSTRAINT "send_batches_counts_valid" CHECK (
    "recipient_count" BETWEEN 1 AND 100
    AND "accepted_count" >= 0
    AND "failed_count" >= 0
    AND "accepted_count" + "failed_count" <= "recipient_count"
  );

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaign_counts_nonnegative" CHECK (
    "target_count" >= 0 AND "eligible_count" >= 0 AND "suppressed_count" >= 0
    AND "accepted_count" >= 0 AND "delivered_count" >= 0 AND "opened_count" >= 0
    AND "clicked_count" >= 0 AND "bounced_count" >= 0 AND "complained_count" >= 0
    AND "failed_count" >= 0
  );
