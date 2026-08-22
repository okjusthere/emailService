# Legacy SQLite migration and cutover

The production runtime has no SQLite dependency. `scripts/migrate-sqlite-v1.ts` is a one-way, read-only V1 importer into PostgreSQL. Keep the legacy database and uploads outside the container build context.

## Prepare

1. Stop V1 scheduling/sending and make the old UI read-only.
2. Make filesystem-level backups of SQLite (including WAL/SHM while the old process is stopped) and referenced uploads.
3. Deploy V2 with `EMAIL_DELIVERY_MODE=disabled`, migration applied, seeded global pause/recovery guard and Worker stopped or paused.
4. Set `DATABASE_URL` to the V2 PostgreSQL target. Use TLS in any non-local environment.

Do not edit the source SQLite file. The CLI requires an absolute path and opens it with `readonly`/`fileMustExist`.

## Dry run

```bash
npm run migrate:v1 -- \
  --sqlite /absolute/path/to/email_service.db \
  --assets-root /absolute/path/to/email-assets \
  --dry-run \
  --report ./migration-report.json
```

Dry-run reads schema/counts, validates normalized emails and reports valid/invalid contacts, tags/links, suppression mappings, legacy campaigns and warnings without connecting writes to V2. The console prints counts and report path, not a contact list. The JSON report is mode `0600`; store it as sensitive operational output.

Review invalid rows, conflicts, missing data and conservative bounce mappings. Correct upstream data or document the disposition; never drop unsubscribes to make counts match.

## Apply and repeatability

```bash
npm run migrate:v1 -- \
  --sqlite /absolute/path/to/email_service.db \
  --assets-root /absolute/path/to/email-assets \
  --apply \
  --report ./migration-report.json
```

Apply upserts contacts/tags/joins by normalized stable keys, creates/strengthens global suppressions and imports legacy campaigns as `LEGACY_ARCHIVE`/`ARCHIVED`. Re-running is idempotent. Unsubscribed → `UNSUBSCRIBE`, complained → `COMPLAINT`, unknown bounced → `LEGACY_BOUNCE_REVIEW`, suppressed → `PROVIDER_SUPPRESSED`. Legacy campaigns and send history are not eligible V2 snapshots and cannot be sent without rebuilding listing/sender/audience/readiness.

The importer preserves available timestamps and sends aggregate/audit summaries. Invalid emails remain report entries. It finds only locally referenced campaign assets under `--assets-root`, rejects path escapes/unsupported magic bytes, strips image metadata, creates 1200/600 variants, deduplicates by checksum, uploads through the configured storage adapter and rewrites archived HTML to permanent URLs. Missing files and per-row failures are reported without blocking contact/suppression import. The default asset root is the `email-assets` directory beside the SQLite file.

## Reconciliation

Compare without exporting full PII into tickets/logs:

- source subscriber count vs valid + invalid;
- normalized distinct contacts and tag join counts;
- every legacy unsubscribed/complained/bounced/suppressed address has an active V2 suppression;
- sampled names/sources/timestamps;
- all imported campaigns are archived/read-only;
- V2 remains globally paused and recovery guard required.

## Cutover

1. Test Entra login and role restrictions.
2. Create/verify a sender, agent and listing with processed hero image.
3. Import a small permissioned contact set and verify an existing suppression remains excluded.
4. Build/save an audience, preview/test campaign and confirm content/recipient snapshot.
5. Verify visible and RFC one-click unsubscribe and signed Webhook ingestion.
6. Switch to `sandbox`, allowlist internal recipients and run a canary through Worker.
7. Complete domain/SPF/DKIM/DMARC/tracking, stable `BASE_URL`, legal address, Reply-To and alert checklist.
8. Reconcile any V1 job that was in-flight at shutdown against Resend; do not assume a missing old DB record means unsent.
9. Admin clears recovery guard/resumes with an audited reason, then deploys `live` and starts with a small batch.
10. Retain V1 database/uploads as access-controlled read-only backup; never restart V1 sending.

Rollback the application to the prior image if needed, but do not point V1 and V2 senders at the same live list. PostgreSQL migrations are forward-only; for recovery, disable delivery and follow `OPERATIONS_RUNBOOK.md` reconciliation before resuming.
