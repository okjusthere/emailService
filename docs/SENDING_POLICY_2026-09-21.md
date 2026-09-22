# Sending policy update — 2026-09-21

Applied to the live service at `https://marketing.homixny.com` at 17:32:54 America/New_York (21:32:54 UTC), under audit request `codex-policy-20260921`.

The Homix Listings sender (`865f3eaf-d57f-41df-acd4-6537c92829de`) is shared by the Portal's `homix_realty` and `homix_living` companies.

| Setting          | Before                      | After            |
| ---------------- | --------------------------- | ---------------- |
| Daily limit      | 100                         | None (`null`)    |
| Batch size       | 1                           | 1                |
| Minimum interval | 120 seconds                 | 60 seconds       |
| Sending window   | 08:00–22:00                 | 08:00–18:00      |
| Timezone         | America/New_York            | America/New_York |
| Allowed days     | Every day                   | Every day        |
| Warm-up          | Enabled, final tier 100/day | Disabled         |

The 18:00 boundary is exclusive. Work resumes at 08:00 the following day. A full ten-hour window permits approximately 600 messages at this pace; there is no separate daily quota. Existing campaigns read the sender configuration when they dispatch.

## Release and verification

- New image: `acrhomixmktg4flyitmde.azurecr.io/homix-marketing@sha256:7d4ce5b9b3f13d7588e8970c638c8d415f5a9f97a4f6e5e54bf699751c4b7953` (ACR build `cjn`).
- Previous Web/Worker image: `acrhomixmktg4flyitmde.azurecr.io/homix-marketing@sha256:defd6e2a748965a6af649228c7c7a8aaeafa8a084fca2cfcebf589b6d93599ca`.
- Schema-only migration `20260921100000_unlimited_sender_daily_quota` succeeded via `caj-homix-mkt-dev-migrate-v0jzjfa`.
- New Web revision `ca-homix-mkt-dev-web--0000025`; new Worker revision `ca-homix-mkt-dev-worker--0000023`. Both became healthy and old revisions stopped before policy activation.
- Sending was temporarily paused with an audit event. There were no in-flight or uncertain batches; all existing batches were accepted. The policy update and restoration of the prior unpaused state were audited atomically. The existing active campaign's pending dispatch was rescheduled without changing recipients, snapshots, or the sender pacing lease.
- TypeScript, ESLint, build and formatting checks passed. All 112 unit tests passed across the full run and an isolated retry of a transient local socket failure; 49 PostgreSQL integration tests and 10 API tests passed against an isolated database using the fake provider.
- After activation, the existing queue advanced from 100 to 102 accepted messages for the local day, proving that the former daily cap was removed. The first two messages were accepted at 21:32:56.976 and 21:33:57.699 UTC, 60.723 seconds apart. The service readiness endpoint remained healthy and the new Worker heartbeat remained current.

Before an application rollback to a version that requires a non-null daily limit, pause sending and restore a positive sender limit first. Keep this additive schema migration; do not reverse it automatically.
