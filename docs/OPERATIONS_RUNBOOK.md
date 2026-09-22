# Operations runbook

All examples require an authenticated Azure CLI and explicit environment/resource group. Never print provider keys, database URLs or recipient payloads.

## Pause all sending

Preferred: in Settings → System readiness choose **Pause all sending** and enter the incident reason. This writes `GLOBAL_SEND_PAUSED=true` plus an audit event; Worker continues Webhook/unsubscribe/reconciliation work while dispatch refuses new provider calls.

For a severe incident only:

```bash
az containerapp update -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-worker --min-replicas 0 --max-replicas 0
```

Do not terminate Web: unsubscribe and Webhook must remain public. In-flight provider requests may complete; reconcile their batch/attempt/provider IDs before any resend.

## Resume

Confirm the root cause, sender readiness, current daily reservation, manual-review batches and suppression ingestion. For a restored database, reconcile queued/accepted batches against Resend first. In Settings choose **Resume after review**, record the reason and explicitly confirm recovery reconciliation. Start with a test/allowlist canary. Restore Worker scale if it was stopped:

```bash
az containerapp update -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-worker --min-replicas 1 --max-replicas 1
```

The `RECOVERY_GUARD` is checked independently of `GLOBAL_SEND_PAUSED`, so directly editing only the pause flag cannot bypass restore safety.

## Gradual delivery policy

The Homix Listings sender uses one recipient per batch, at least 60 seconds between provider submissions, and a daily 08:00–18:00 window in `America/New_York`, including weekends. There is no daily quota (`dailyLimit: null`) and warm-up is disabled. The end of the window is exclusive: delivery stops at 18:00 and resumes at 08:00 the next day. The full window has a theoretical capacity of 600 messages, with actual throughput reduced by processing time, retries, or other delivery gates. Portal and native Campaigns share the same sender policy. The Composer confirmation estimates completion from these persisted sender fields.

Nullable daily quotas retain daily reservation and acceptance accounting. Positive daily limits and explicitly enabled warm-up schedules remain available for other sender policies. The schema migration only changes defaults and enables null; existing sender rows require an audited policy update after Web and Worker both run the compatible release.

`sender_profiles.next_batch_at` is claimed in a serializable transaction before both initial batches and safe retries. It is shared across every Campaign using that sender, so adding Campaigns or workers does not multiply the send rate. Do not clear it to speed delivery. To change pacing, pause sending first, review active/queued batches and deliverability, update the sender policy through the authenticated API/UI, and resume with an audit reason. Daily quota, send window, global pause, recovery guard, suppression and deliverability thresholds remain independent gates.

## Worker stalled

```bash
az containerapp logs show -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-worker --follow
az containerapp revision list -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-worker -o table
```

Check Settings readiness `workerHeartbeat`, PostgreSQL connectivity, locked jobs and Provider health. Locks expire through the database claim protocol. Restart the current revision only after identifying whether any batch is `SUBMITTING` or `MANUAL_REVIEW`; do not bulk reset uncertain batches. Verify heartbeat becomes fresh and a fake/sandbox canary advances once.

## Provider timeout / uncertain batch

Within Resend's supported idempotency window, a temporary failure retries the same `send_batches.idempotency_key`. A timeout that may have occurred after submit moves to `MANUAL_REVIEW` and is never automatically sent under a new key. Compare batch request hash, attempt time, recorded provider IDs and Resend dashboard. Resolve recipients individually only with evidence; there is no “resend all uncertain” control.

Settings → Manual review exposes `MARK_ACCEPTED`, `MARK_NOT_SENT`, `ATTACH_PROVIDER_ID`, `SAFE_RETRY`, `RELEASE_QUOTA` and `KEEP_IN_REVIEW`. Every action requires a reason, locks the batch, adjusts reserved/accepted/released quota atomically where applicable and writes both a resolution row and audit event. Attach a provider ID only to the exact recipient confirmed in Resend. Use safe retry only before the original idempotency expiry.

## Webhook reconciliation

An unmatched signed Webhook is not marked complete. Worker retries after 30 seconds, 2 minutes, 10 minutes, 30 minutes and 2 hours, which allows a delayed provider ID commit to become visible. After the final miss it becomes `DEAD_LETTER`. Settings → Webhooks shows pending/dead-letter events and attempts. Investigate provider ID, recipient creation and event timing; never edit the payload or invent a recipient link. Replay processing only after the missing local record is repaired.

## Engagement reporting and Resend domain tracking

Portal reports listing-link requests, not readers or sales leads. Opens are omitted from its main report. Delivery means the receiving mail server accepted the message, not inbox placement. Current delivered, pending and undelivered results partition accepted messages; historical receipt timestamps remain available. Click rate uses only the same tracked recipients with delivery receipts in both numerator and denominator. Explicit bot user agents and unsubscribe/company links do not count as listing CTA clicks; unrecognized clients remain unknown rather than being labeled human.

Resend domain configuration is authoritative. Sender tracking fields are read-only mirrors; attempts to edit them return `TRACKING_MANAGED_BY_PROVIDER_DOMAIN`. An admin can read back current configuration with `POST /api/v2/sender-profiles/:id/tracking/refresh` or `node dist/server/scripts/refresh-domain-tracking.js updates.homixny.com`. A true capability requires both the provider flag and the exact current tracking CNAME to be verified. Reads are cached for five minutes, bounded by an eight-second timeout, and serialized across replicas. Failed or stale reads produce unknown coverage and do not intentionally stop normal sending.

Each batch freezes its tracking snapshot before first submission. Accepted recipients inherit it; idempotency retries and manual acceptance retain that original snapshot. Historical nulls are unknown, never backfilled from today's settings. Campaign metrics return `null` when unmeasured, genuine `0` only within a known tracked cohort, and `partial` when only some accepted messages were tracked. Monitor webhook pending/dead-letter queues and the report's `asOf`; no clicks alone is not evidence of a broken pipeline.

For the Homix marketing rollout, use only `updates.homixny.com` (shared by the Portal brands). Keep open tracking off and enable click tracking with the `links` subdomain. Do not change invoice/info domains.

1. Deploy the additive migration, Web and Worker before enabling tracking. Run `node dist/server/scripts/backfill-campaign-reporting.js` for a dry-run, then `--apply` to populate derived summaries. This command does not run deliverability guards, change suppression, or infer old tracking coverage.
2. Pause sending through the audited admin flow, retain the previous pause state, and wait for in-flight submissions to settle. Investigate uncertain/manual-review batches before changing the domain; do not clear sender cadence or resend accepted messages.
3. Read the actual Resend domain ID and configuration. In Domains → Configuration (or the official domain update API), set `click_tracking=true`, `open_tracking=false`, `tracking_subdomain=links`. Add the exact DNS records returned by Resend at the authoritative DNS provider. Configure any required CAA authorization according to those instructions; never guess the CNAME target.
4. Read back the provider state until the current tracking record is verified, then force the service observation refresh. Keep tracking DNS after activation, including after a later rollback. A verified sender domain alone is insufficient.
5. Use approved internal recipients in an isolated campaign with actual recipient/provider-ID mapping. Check received HTML, HTTPS tracking redirect and final CTA, visible and one-click unsubscribe, signed webhook classification, unique-recipient count and Portal refresh. Record this acceptance evidence and timestamp in the operational audit; provider configuration alone is not end-to-end acceptance.
6. Restore the prior sending state only after boundary reconciliation. Never claim old untracked messages are measurable or resend them to collect analytics. Follow existing pacing and shared queue policy.

If DNS access or end-to-end validation is unavailable, keep the provider flags unchanged and release the accurate unavailable-state UI first. To roll back tracking, disable future tracking in Resend, refresh observations at a controlled send boundary, retain all historical events/snapshots, and **keep the existing tracking DNS** so previously sent links continue working. See [Resend tracking configuration](https://resend.com/docs/dashboard/domains/tracking).

## Bounce classification and historical review

`Permanent` creates `HARD_BOUNCE`; `Transient` creates a `SOFT_BOUNCE` review hold; `Undetermined` creates `BOUNCE_REVIEW`. Temporary and undetermined holds remain active until reviewed, without declaring the address permanently invalid. `delivery_delayed` leaves retry responsibility with the provider. Never send the same accepted message again because it bounced or was delayed.

Suppression causes are appended to the audit trail and stronger existing reasons win. In particular, a later temporary bounce cannot override a complaint, unsubscribe, permanent bounce or administrator hold. Diagnostic summaries use fixed safe text; raw provider diagnostics are not exposed to Portal.

Run `node dist/server/scripts/audit-bounce-classification.js --limit 500` to inspect historical `HARD_BOUNCE` rows. The script enforces a read-only transaction and reports candidate IDs without recipient addresses. It never releases a hold, reclassifies records or resends. Examine all cause history before any separately reviewed historical correction; missing evidence is a reason to keep the hold. An old unclassified bounce is displayed as awaiting classification, not silently assumed permanent.

## API key rotation

1. Create a new Resend API key.
2. Write a new Key Vault secret version without shell-history exposure: `./scripts/set-key-vault-secret.sh RESOURCE_GROUP VAULT resend-api-key`.
3. Create a new Web/Worker revision or refresh the secret reference.
4. Perform an allowlisted test send.
5. Revoke the old key.
6. Record the rotation in the operational audit system without the key value.

## Webhook secret rotation

Write the new current value as `resend-webhook-secret` and the old value as `resend-webhook-previous-secret` with `scripts/set-key-vault-secret.sh`. Deploy with `USE_PREVIOUS_RESEND_WEBHOOK_SECRET=true` and an ISO expiry in `RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT`, update Resend, replay a signed test, wait for the overlap to expire, then set the flag false and deploy again. Webhook IDs remain deduplicated throughout.

## Unsubscribe signing-secret rotation

Unsubscribe tokens do not use the session secret. Copy the old current value to `unsubscribe-previous-signing-secret`, install a new random `unsubscribe-signing-secret`, and deploy with `USE_PREVIOUS_UNSUBSCRIBE_SIGNING_SECRET=true` and a reviewed ISO expiry. Verify both an old visible link and a new one, then disable/remove the previous reference after expiry. Never rotate by changing `SESSION_SECRET`, and never leave the previous expiry unset.

## OneKey/BBO operations

Keep `EMAIL_DELIVERY_MODE=disabled` while enabling `ONEKEY_PROVIDER=bbo`. Install a dedicated BBO bearer key in `bbo-marketing-api-key`, configure the HTTPS base URL and enable its Key Vault reference. If listing images are served from a different origin, set `ONEKEY_MEDIA_ALLOWED_ORIGINS` to the exact comma-separated HTTPS origins; paths, credentials, and wildcard hosts are rejected. In Settings:

1. Test Connection.
2. Run initial sync and wait for the cursor success/count.
3. Search the fixture/approved listing by MLS number and address.
4. Import the listing and confirm **Signature & replies** shows the current OneKey listing Agent. Import automatically reads the listing-scoped Agent contact from BBO and upserts it by stable `memberKey`; it must never fall back to the first local Agent. A missing/inactive roster Agent or invalid email must stop the flow with an explicit error. Manual Agent creation is only a fallback for manually created properties or an approved override.
5. Refresh and confirm user marketing overrides remain unchanged.
6. Open the OneKey Composer and confirm the default **Nearby active agents** choice automatically progresses from “Finding recipients from BBO…” to the eligible/held-back summary without an extra import click. Use **Adjust** only when an operator intentionally changes the 12–24 month or 0–5 nearby-ZIP criteria. Confirm listing and buyer sides are deduplicated, only active agents with valid email remain, and the Homix office is excluded.

Provider outage degrades only the integration; it does not make the application unready. Leave sync disabled if the BBO key/scope or licensed data path is not confirmed. Rotate the BBO key by installing a new Key Vault version, deploying/testing, then revoking the old key.

## AI operations

Use either a dedicated Homix Marketing OpenAI project or an approved Azure OpenAI deployment and store its key as `openai-api-key`. For Azure, set `AI_PROVIDER=azure-openai`, `OPENAI_BASE_URL=https://RESOURCE.openai.azure.com/openai/v1`, and `OPENAI_MODEL` to the deployment name. The server uses the Azure `api-key` header and rejects non-`*.openai.azure.com/openai/v1` endpoints before a key can be sent.

While delivery remains disabled or sandboxed, test at least two imported listings. The UI must report a production provider/model; `fake-deterministic-v1` is test-only and its Generate buttons are disabled. Review source facts versus proposal, apply only selected fields, then generate/apply a Campaign proposal. Confirm the preview contains the complete description and listing Agent name/company/email. Simulate provider failure to confirm manual editing/sending still works. Rotate by publishing a new Key Vault version, deploying/testing generation, then revoking the old key. AI errors must never trigger delivery retries or block a manual Campaign.

## Public beta send sequence

1. Keep `sandbox`, global pause and recovery guard in place while creating the Resend webhook and refreshing the Key Vault reference.
2. Verify `/api/v2/ai/status` reports `mode=production`, generate/apply listing and Campaign proposals, activate the reviewed listing, let the Composer automatically import the BBO recipient audience, and inspect the eligible/held-back estimate.
3. Preview and send a new allowlisted canary. Confirm complete content, listing Agent signature/Reply-To, visible unsubscribe, provider delivered event and signed webhook processing.
4. Mark the current Campaign ready. Clear the recovery guard and global pause through the audited Admin resume endpoint with a real reason.
5. Deploy `EMAIL_DELIVERY_MODE=live`. Confirm the review dialog matches the persisted sender policy and estimated timing before starting the small scheduled Campaign; do not bypass permission, suppression, test-send, sender-slot or quota gates.
6. Watch delivered, hard bounce and complaint events. Pause immediately on an unexpected audience, identity, content, webhook or deliverability result.

## Complaint or bounce spike

Pause the affected sender/campaign immediately. Verify complaint/hard-bounce suppressions were created and never release complaint suppressions. Audit recent import source, permission state, content, From identity and domain typos. Treat soft/provider-temporary failures separately. Resume only after causes and configured thresholds are reviewed; do not rotate random From addresses/subdomains to bypass reputation signals.

## Database backup, PITR and restore

Azure PostgreSQL backup retention is parameterized from 7–35 days (starter default 7, production-tier default 14). Geo-redundant backup is off unless `enableGeoRedundantBackup=true` is explicitly chosen. Regularly rehearse point-in-time restore to an isolated server. After any restore:

1. keep `EMAIL_DELIVERY_MODE=disabled` and Worker scaled to zero;
2. set `GLOBAL_SEND_PAUSED=true` and `RECOVERY_GUARD.required=true` before Worker starts;
3. reconcile non-terminal campaigns, recipient provider IDs, `SUBMITTING`/manual-review batches and pending dispatch jobs with Resend;
4. run `prisma migrate deploy` using the migration job;
5. verify health, Webhook, unsubscribe and counts;
6. start Worker but retain DB pause;
7. use the audited Admin resume flow only after reconciliation.

An old snapshot can forget provider submissions; therefore queued work must never resume automatically.

## Blob recovery and retention

Blob/container soft delete is 7 days dev and 30 days prod. Public marketing images are intentionally anonymously readable; `private-exports` has no public access. Listing archive and asset record deletion do not immediately delete historical snapshot URLs. When recovering, restore the same blob names/checksums so old emails remain valid. Orphan cleanup must retain a grace period and confirm no campaign snapshot reference.

## Deployment rollback

`scripts/deploy-release.sh` prints exact commands for prior Web/Worker images. Otherwise:

```bash
az containerapp revision list -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-web -o table
az containerapp show -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-web --query properties.template.containers[0].image -o tsv
az containerapp update -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-web --image REQUIRED_PREVIOUS_IMAGE
curl -fsS https://marketing.homixny.com/health/ready
az containerapp update -g REQUIRED_RESOURCE_GROUP -n ca-homix-mkt-prod-worker --image REQUIRED_PREVIOUS_IMAGE
```

Do not reverse a destructive migration. Keep sending paused until the old application is confirmed schema-compatible and heartbeat is fresh.

## Routine checks

- `/health/live`: process is alive.
- `/health/ready`: DB, migration and role configuration are valid.
- Settings readiness: delivery mode, default sender, address, global pause, recovery guard, heartbeat.
- Application Insights: 5xx, latency and structured request/job/provider errors by request ID; no recipient dump.
- Alert on structured `deliverability_threshold_exceeded`, `batch_failed`, stale `Worker heartbeat updated`, failed jobs and readiness failures. The app itself pauses the affected campaign and suspends its sender after the configured minimum sample crosses complaint/bounce thresholds; alerts are a notification layer, not the safety control.
- Campaign detail: accepted/delivered/bounced/complained/failed/manual-review denominators.
- Key Vault secret expiry, Entra credential expiry, PostgreSQL backup/restore drill and DNS/DMARC reviews.
