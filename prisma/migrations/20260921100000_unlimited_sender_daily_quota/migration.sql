-- NULL means there is no daily quota. The existing positive-value CHECK still
-- rejects zero and negative finite limits while permitting NULL.
ALTER TABLE "sender_profiles"
  ALTER COLUMN "daily_limit" DROP NOT NULL,
  ALTER COLUMN "daily_limit" DROP DEFAULT,
  ALTER COLUMN "batch_size" SET DEFAULT 1,
  ALTER COLUMN "min_batch_interval_seconds" SET DEFAULT 60,
  ALTER COLUMN "send_window_start" SET DEFAULT '08:00',
  ALTER COLUMN "send_window_end" SET DEFAULT '18:00',
  ALTER COLUMN "allowed_weekdays" SET DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];
