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

The Homix Listings sender is intentionally configured for sparse delivery, not provider throughput: one recipient per batch, at least 300 seconds between provider submissions, weekdays 09:30–16:30 in `America/New_York`, and no more than 80 accepted recipients per local day. Warm-up begins at 30/day, remains 30 on day 2, increases to 50/day on days 3–4, and reaches 80/day on day 5. The Composer confirmation estimates completion from these persisted sender fields.

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
5. Deploy `EMAIL_DELIVERY_MODE=live`. Confirm the review dialog reports one email every five minutes, the daily warm-up ceiling and the estimated completion time before starting the small scheduled Campaign; do not bypass permission, suppression, test-send, sender-slot or quota gates.
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
