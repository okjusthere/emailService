-- Original attempt snapshots remain immutable. Retries crossing a tracking
-- configuration boundary cannot establish which configuration accepted the mail.
ALTER TABLE "send_batches"
  ADD COLUMN "tracking_coverage_uncertain" BOOLEAN NOT NULL DEFAULT false;
