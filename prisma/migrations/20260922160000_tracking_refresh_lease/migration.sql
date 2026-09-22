-- Fence overlapping domain observations, including forced admin refreshes.
ALTER TABLE "provider_domain_tracking"
  ADD COLUMN "refresh_token" UUID,
  ADD COLUMN "refresh_lease_until" TIMESTAMPTZ(3);
