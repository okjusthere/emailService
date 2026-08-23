# Data model

`prisma/schema.prisma` is the source of truth. Deployable migrations are `20260821190229_initial` and `20260822090000_predeploy_patch`; migrations are replayed with `prisma migrate deploy`, never production `db push`. All timestamps representing instants use `timestamptz`; sender quota day is stored as a date in the sender timezone.

## Identity and reference data

- `users`: normalized unique email, optional Entra object ID, ADMIN/MARKETER/VIEWER and active flag.
- `agents`: broker display/signature/Reply-To identity, optionally linked one-to-one to a user.
- `tags`, `markets`, `property_interests`: normalized reference vocabulary. `markets.parent_id` supports hierarchy.
- `contact_tags`, `contact_markets`, `contact_property_interests`: explicit many-to-many targeting joins.

## Contacts and compliance

- `contacts`: original and normalized email, names/company/type/source/permission state, status, archive metadata and send/engagement summaries. `MLS_AGENT_MATCH` records retain BBO selection metadata; re-import upserts the contact but never clears suppression.
- `suppressions`: global normalized-email block with reason, source, severity-compatible history, optional campaign/recipient origin and explicit release metadata. Only one active row per normalized email/reason/source tuple.
- `contact_imports`, `contact_import_rows`: private CSV object key, mapping/source confirmation, aggregate status, masked row-level errors and apply state.
- `unsubscribe_events`: immutable visible/one-click audit linked to recipient where available.

## Listings and assets

- `listings`: marketing facts, location, pricing, URL, description/highlights, assigned Homix agent and DRAFT/ACTIVE/ARCHIVED state. Source metadata (`MANUAL`/`ONEKEY`, source key/snapshot/timestamps/status/warnings) is separate from editable marketing overrides; `(source, source_key)` prevents duplicate OneKey imports.
- `listing_assets`: original/email-safe blob names, MIME/dimensions/checksum, PHOTO/HERO/BROCHURE role, sort order and soft deletion. Image uploads produce EXIF-free 1200px and 600px JPEG variants; campaign snapshots retain their immutable public URLs.
- `onekey_listing_index`: searchable MLS/address cache used for local search and refresh. It is not a marketing listing and may contain records never imported by a user.
- `external_sync_cursors`: provider cursor, start/success/error timestamps and counters for initial/delta replication.

An ACTIVE listing requires a usable URL and hero image. Archiving database records never mutates already-frozen campaign content.

## Audience and campaign aggregate

- `saved_audiences`: versioned, validated JSON DSL, estimated count and audit ownership. The compiler accepts only enumerated fields/operators and Prisma query fragments—never arbitrary SQL.
- `sender_profiles`: stable From identity, reply policy, timezone/window/weekdays, daily/batch limits, warm-up schedule, tracking preferences, verification/readiness and default profile.
- `campaigns`: listing/audience/sender/template selection, editable content, optimistic `version`, state machine, scheduled/started/completed timestamps, frozen `content_snapshot`, aggregate counters and test-send evidence.
- `campaign_recipients`: immutable recipient/name/company snapshot, eligibility/suppression reason, independent `send_state`, `delivery_state`, engagement timestamps, provider ID and signed-unsubscribe-token hash.

Opened/clicked timestamps never overwrite bounced/complained delivery state. Event reduction keeps earliest occurrence timestamps and the maximum provider-event timestamp, so out-of-order Webhooks do not regress state.

## Delivery and jobs

- `send_batches`: stable idempotency key and request hash, sender/date reservation, retry expiry, batch status and counts. Constraints enforce 1–100 recipients and non-negative counters.
- `send_attempts`: an immutable attempt chain created before provider submission; records outcome/request hash/provider summary or sanitized error.
- `sender_daily_usage`: unique sender/local-date counters for reserved, accepted and released capacity. Serializable reservation and row locking prevent concurrent workers from exceeding the limit.
- `jobs`: PostgreSQL durable queue with unique key, run time, lock/expiry, attempts and last error. Claiming uses `FOR UPDATE SKIP LOCKED`; live workers renew active locks, and a different worker can reclaim an expired RUNNING lock after a crash. Seed starts a self-renewing daily retention cleanup chain.
- `email_events`: signed Webhook inbox, unique `webhook_id`, raw structured payload, provider time, recipient link, reconciliation status/attempt count/next attempt/dead-letter time and processing result.
- `test_sends`: allowlisted test evidence and outcome, including client request UUID and the composite idempotency key.
- `manual_review_resolutions`: append-only operator action, reason, optional recipient/provider ID and released quota for uncertain send batches.
- `ai_generations`: listing/campaign kind, provider/model/tone, allowlisted fact hash, structured proposal, selected applied fields and lifecycle timestamps.
- `audit_logs`: actor, action, entity, before/after metadata, request/IP context. Secrets and bulk PII are excluded.
- `system_settings`: global pause, recovery guard, Worker heartbeat and adjustable operational thresholds/settings.

The default deliverability settings require a sample of 100 accepted messages, then pause the campaign and suspend its sender at a complaint rate of 0.1% or bounce rate of 5%. The latest action-required alert is exposed in system readiness for operator review; thresholds are data, not hard-coded provider-policy claims.

## Core invariants

1. Campaign content and recipient selection freeze in one transaction before scheduling.
2. Every provider-bound recipient belongs to one durable batch; the batch key is stable across its safe retry chain.
3. Reserved quota changes atomically with claims; accepted/released counters reconcile reservation.
4. Suppression is checked at snapshot and immediately before provider submission.
5. Complaint/bounce state and global suppression are not undone by later delivered/opened events.
6. Deletion is soft where historical campaign/audit integrity or public asset longevity matters.
