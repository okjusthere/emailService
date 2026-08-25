# API guide

The complete contract is `openapi.yaml` (OpenAPI 3.1). Authenticated routes are mounted at `/api/v2`; public routes are under `/api/public`. JSON errors use a stable domain code/message and include the request ID.

## Authentication and CSRF

Production uses Azure Container Apps Easy Auth. The server decodes the platform-verified `X-MS-CLIENT-PRINCIPAL`, maps the Entra identity to `users`, and obtains roles only from PostgreSQL. Local development uses `POST /api/v2/auth/dev-login` and a signed HttpOnly cookie; the route is unavailable in production.

All `/api/v2/*` requests require a user. Mutations using cookie auth require the same-origin CSRF header supplied by the SPA. ADMIN controls users, verification, suppression release and global sending; MARKETER manages marketing entities; VIEWER is read-only. Marketers only see their own audit rows.

## Main resources

| Area        | Representative operations                                                                  |
| ----------- | ------------------------------------------------------------------------------------------ |
| Auth/users  | `GET /auth/me`, user list/create/role update                                               |
| Agents      | list/create/get/update/deactivate                                                          |
| Contacts    | cursor list, CRUD/archive/restore, bulk update, formula-safe CSV export                    |
| Imports     | multipart upload, validate, apply, status, error CSV                                       |
| Reference   | tags, market hierarchy, property interests                                                 |
| Suppression | list/manual add/Admin release                                                              |
| Listings    | cursor list, CRUD/duplicate/archive, multipart assets/reorder/delete, source refresh       |
| OneKey      | status/test/sync, MLS/address search, review/import, media retry, recipient preview/import |
| AI copy     | status, listing/campaign proposal generation and explicit selected-field apply             |
| Audiences   | estimate, saved CRUD/duplicate                                                             |
| Senders     | full CRUD, verification/reactivation/suspension/default selection, quota                   |
| Campaigns   | list/detail/update/duplicate/preview/test/ready/schedule/send/pause/resume/cancel          |
| Reporting   | campaign stats/recipients/events/export, dashboard, audit                                  |
| Operations  | readiness, global pause/resume, Webhook reconciliation/dead letters, manual review         |

Contacts, listings and campaigns support `limit` plus opaque UUID `cursor` pagination; responses include `nextCursor`. Existing page parameters remain accepted on report/reference endpoints where offset navigation is sufficient. Contact filters cover type/source/permission/status/tag/market/property-interest/suppression and safe sort fields; listing filters cover status/property/transaction/agent; campaign recipients and their CSV export accept send/delivery state filters. Filters are enumerated and validated by Zod.

CSV import is an explicit four-step flow: upload and inspect headers/masked preview, submit a canonical-field-to-header mapping, review invalid/duplicate/suppressed counts and unknown references, then apply. Unknown tags, markets or property interests are not created unless the apply request explicitly sets `confirmCreateUnknownReferences`.

Campaign mutations that can be retried use explicit idempotency or optimistic concurrency: draft updates check version; send-now accepts a client idempotency key and reuses the durable dispatch job/snapshot instead of duplicating recipients.

Test send requires a client-generated UUID `clientRequestId`. Its idempotency identity includes campaign/version, actor, normalized-recipient hash and that UUID. Retrying a failed HTTP request with the same UUID is safe; creating a new UUID intentionally sends another test.

## Simplified composer orchestration

The V3 browser flow uses three orchestration endpoints while retaining all V2 primitives:

- `POST /campaigns/quick-start` requires `Idempotency-Key` and a `listingId`. It serializes double-clicks, reuses the current user's recent draft for that listing, or creates a draft with the verified default sender, listing Agent reply identity, safe fallback content and Homix listing CTA.
- `POST /campaigns/{id}/recipients/onekey-nearby` requires the optimistic campaign `version`. It bulk imports compliant BBO candidates, creates an isolated campaign-specific saved group, applies permission/suppression/recent-contact/previous-listing exclusions, invalidates prior test evidence and returns a compact count summary.
- `POST /campaigns/{id}/publish` requires `Idempotency-Key`, current `version`, and optional `scheduledAt`. Under a row lock it verifies a successful test for that version, live-send readiness, and the current state, then queues the existing immutable snapshot worker job. A replay with the same key is safe.

`POST /product-events` accepts only enumerated low-cardinality UX events and per-event allowlisted, size-bounded scalar metadata. It writes to the existing audit trail and rejects content, recipient lists, provider details or secrets.

## OneKey/BBO and AI endpoints

```text
GET  /api/v2/onekey/status
POST /api/v2/onekey/test
POST /api/v2/onekey/sync/{initial|delta|rebuild}
GET  /api/v2/onekey/listings/search?q=MLS_OR_ADDRESS
GET  /api/v2/onekey/listings/{sourceKey}
POST /api/v2/onekey/listings/{sourceKey}/import
POST /api/v2/listings/{id}/onekey/refresh
POST /api/v2/listings/{id}/onekey/media/retry
GET  /api/v2/onekey/listings/{sourceKey}/recipients
POST /api/v2/listings/{id}/onekey/recipients/import
GET  /api/v2/ai/status
POST /api/v2/listings/{id}/ai/{generate|apply}
POST /api/v2/campaigns/{id}/ai/{generate|apply}
```

Search reads the local PostgreSQL OneKey index first, then the configured provider. Import is idempotent by `(source, sourceKey)` and never applies a listing-office ownership gate. Unless an administrative compatibility override supplies `agentId`, import fetches BBO's listing-scoped Agent contact, upserts the local Agent by `(sourceSystem, sourceAgentKey)`, and binds the listing, signature and Reply-To automatically. It never falls back to the first local Agent. Recipient candidate parameters are bounded: `nearbyZipCount` 0–5, `closedMonths` 12–24 and `limit` 1–5000. Candidate creation is a separate, confirmed mutation and creates a saved audience; preview alone never writes contacts.

The production adapter calls BBO server-to-server with a bearer key. The token and raw provider responses are never returned. The `marketing:read` key may resolve only the Agent attached to a specified viewable listing and remains denied from the full BBO Agent roster. AI generation stores model, provider, fact hash and proposal; only enumerated selected fields are applied, and no endpoint passes contacts, recipients or secrets to the AI provider.

For listing Campaigns, the server derives `replyToAgentId`, rendered signature and provider `Reply-To` from the selected listing's assigned Agent on every create/update/duplicate and preview/snapshot. A caller-supplied legacy `replyToAgentId` cannot override that identity.

## Public endpoints

```text
GET  /health/live
GET  /health/ready
POST /api/public/webhooks/resend
GET  /unsubscribe?token=...
POST /api/public/unsubscribe/confirm
POST /api/public/unsubscribe/one-click?token=...
GET  /public/assets/*      local storage adapter only
```

Webhook requires valid Svix/Resend signature headers against the exact raw request bytes. Its `svix-id` is unique and replay-safe. Visible unsubscribe GET only renders confirmation; mutation occurs on POST. RFC 8058 one-click returns `204` and is idempotent. Invalid/expired/tampered tokens do not reveal recipient identity. Public routes are rate limited and never redirect to caller-provided URLs.

## Example local session

```bash
curl -i -c /tmp/homix-cookie.txt \
  -H 'content-type: application/json' \
  -d '{"email":"admin@homixny.com"}' \
  http://localhost:3000/api/v2/auth/dev-login

curl -b /tmp/homix-cookie.txt http://localhost:3000/api/v2/auth/me
```

Use the browser SPA for mutations so it supplies the request/CSRF headers correctly. Never enable local auth in production.

## Health semantics

`/health/live` means the Web process event loop is serving. `/health/ready` validates application role/config, database reachability and applied Prisma migration; it returns non-2xx while unavailable. Admin `/api/v2/system/readiness` additionally reports sender/address/delivery mode, pause/recovery guard and Worker heartbeat.

All deployment roles use the same image. `APP_ROLE=web` serves HTTP, `APP_ROLE=worker` runs durable jobs, and `APP_ROLE=migrate` applies Prisma migrations followed by the idempotent seed before exiting.

Regenerate no code from the OpenAPI file automatically; route implementation and schema are reviewed together. CI runs `npm run openapi:lint`.
