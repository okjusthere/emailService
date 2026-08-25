ALTER TABLE "sender_profiles"
  ADD COLUMN "next_batch_at" TIMESTAMPTZ(3);

ALTER TABLE "sender_profiles"
  ALTER COLUMN "daily_limit" SET DEFAULT 80,
  ALTER COLUMN "batch_size" SET DEFAULT 1,
  ALTER COLUMN "min_batch_interval_seconds" SET DEFAULT 300,
  ALTER COLUMN "send_window_start" SET DEFAULT '09:30',
  ALTER COLUMN "send_window_end" SET DEFAULT '16:30';

UPDATE "sender_profiles"
SET
  "daily_limit" = LEAST("daily_limit", 80),
  "batch_size" = 1,
  "min_batch_interval_seconds" = 300,
  "send_window_start" = '09:30',
  "send_window_end" = '16:30',
  "warmup_enabled" = TRUE,
  "warmup_start_date" = CURRENT_DATE,
  "warmup_schedule" = '[{"day":1,"limit":30},{"day":3,"limit":50},{"day":5,"limit":80}]'::jsonb,
  "next_batch_at" = NULL
WHERE "provider" = 'resend'
  AND "name" = 'Homix Listings';
