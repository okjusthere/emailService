# Homix Portal integration

Production service: https://marketing.homixny.com

The Portal calls `/api/integrations/homix/v1` from its server. Browsers use the Portal proxy `/api/marketing/email`; they never receive the HMAC secret. Campaigns carry `sourceApplication=homixliving`, a stable numeric Portal Agent owner and an immutable marketing identity snapshot. The shared MLS listing keeps its original agent.

## Receiver configuration

- Apply `20260910180000_homix_portal_integration` with the usual Prisma migration deployment process before enabling the routes.
- Set `HOMIX_PORTAL_INTEGRATION_SECRET` to the same secret as the Portal's `EMAIL_SERVICE_HOMIX_SECRET`, through the existing secret manager/container secret reference.
- Set `HOMIX_PORTAL_COMPANIES_JSON` to a JSON object keyed by Portal licensed company ID. Each value needs `senderProfileId`, `companyName`, `companyAddress`, `companyWebsite`. Only active VERIFIED sender profiles are accepted. From email stays the verified address; From display name uses the configured brokerage, and Reply-To and signature use the Portal Agent snapshot.
- Preserve existing delivery mode, Resend, BBO, suppression, queue and sender pacing settings. Production currently uses live delivery. Read-only health checks must never call publish or test-send.
- The user explicitly approved and the production service now has **only** `/api/integrations/homix/v1/*` added to its existing EasyAuth exceptions. The previous automatic review rejection was resolved by that explicit approval. All other EasyAuth properties were preserved. Unsigned requests reach the application and return `INVALID_PORTAL_TOKEN` (401). The HMAC middleware remains mandatory on every integration endpoint. Existing UI and other routes remain protected by Azure login.

Verified sender ID on 2026-09-10: `865f3eaf-d57f-41df-acd4-6537c92829de`, `listings@updates.homixny.com`.

Company map verified against Portal licensed-company definitions and deployed:

```json
{
  "homix_realty": {
    "senderProfileId": "865f3eaf-d57f-41df-acd4-6537c92829de",
    "companyName": "Homix Realty Inc.",
    "companyAddress": "37-20 Prince St, STE 3H, Flushing, NY 11354",
    "companyWebsite": "https://homixny.com"
  },
  "homix_living": {
    "senderProfileId": "865f3eaf-d57f-41df-acd4-6537c92829de",
    "companyName": "Homix Living Inc.",
    "companyAddress": "110 Charlton St #A, New York, NY 10014",
    "companyWebsite": "https://homixny.com"
  }
}
```

## Request authentication and ownership

Bearer JWT uses HS256, issuer `homixliving`, audience `email-service`, and expiry at most 90 seconds. Claims bind the method, exact original URL including query, and SHA-256 of the canonical JSON body (GET uses an empty string). Claims also bind `sub` to `brand.agentId` and email to the brand email. All write requests include a version or a stable client request ID as required below.

The receiver provisions an internal principal on first signed request, identified only by User.portalAgentId. User.email remains the signed contact email; emailNormalized stores the non-email namespace key portal-agent:<id>. Native account lookup cannot collide with that key. Two Portal Agents may share a contact email without sharing ownership, and email changes retain the same internal ID. Disabled Portal principals remain blocked. Native authentication rejects Portal-managed principals.

A same-email native administrator remains separate with its original role and login. If an older manual mapping points at a native administrator or Entra identity, the receiver detaches that mapping and creates a Portal principal while preserving the native account and historical foreign keys. Campaign access still uses Portal ownership. The legacy link-homix-portal-user script is not part of the supported onboarding flow and must not be used for new Portal users. No registration or manual association is required.

All campaign operations scope by application and owner, or by application for a Portal administrator. Cross-owner IDs return 404. Global contact exports and unrelated Email Service campaigns are not exposed.

## API surface

| Method    | Relative path                                  | Purpose                                                            |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| GET       | `/status`                                      | Configuration and self-test eligibility                            |
| GET       | `/listings?query=…`                            | MLS/address search, safe listing fields                            |
| GET       | `/listings/:sourceKey`                         | Listing detail                                                     |
| GET/POST  | `/campaigns`                                   | Paged own campaigns / create with sourceKey and clientRequestId    |
| GET/PATCH | `/campaigns/:id`                               | Detail / edit draft with version                                   |
| GET       | `/campaigns/:id/stats`                         | Scoped delivery statistics                                         |
| POST      | `/campaigns/:id/nearby`                        | Existing nearby closed-transaction Agent selection                 |
| POST      | `/campaigns/:id/preview`                       | Render saved draft                                                 |
| POST      | `/campaigns/:id/test`                          | Test to the current Agent's own allowlisted email                  |
| POST      | `/campaigns/:id/publish`                       | Immediate or scheduled publishing with version and clientRequestId |
| POST      | `/campaigns/:id/pause`, `/resume`, `/cancel`   | Existing campaign lifecycle                                        |
| POST      | `/campaigns/:id/ai`, `/campaigns/:id/ai-apply` | Suggest/apply version-bound copy                                   |

Exact request schemas are defined in `src/web/routes/homix.ts`. Sender pacing, recipient suppression, version freshness, successful test requirements and provider outcome handling remain enforced by the existing campaign services. Requests are limited per Agent (120/minute, expensive actions 20/hour).

## Poster selling-point extraction

POST /api/integrations/homix/v1/poster-highlights accepts a validated listing description and structured property facts. It uses the existing Azure text provider and deployment (production gpt-5.6-terra). The response contains up to six distinctive selling points and four separate financial facts, each with English and Simplified Chinese versions and an exact source excerpt. The receiver validates evidence and numeric values; unsupported source claims fail rather than becoming poster copy.

The endpoint shares mandatory HMAC, active mapped-user checks and the expensive-action limit. No model key is exposed to the Portal browser. The Portal displays evidence, lets the Agent select up to four selling points and edit both versions, and requires confirmation before detailed poster generation. Only those selected localized points reach Azure gpt-image-2; no raw paragraph compression is requested.

MLS search/detail also expose explicit structured annual property tax, monthly maintenance, association fee and its documented billing period. Unknown amounts and periods stay absent; genuine zero remains zero. The mapper never assumes an unlabelled fee is monthly.

Unit validation/provider tests and listing-cost mapping tests are included in the 78 passing unit tests (15 files). API regression: 9 passed. TypeScript and client/server builds passed.

## Verification and rollout

Unit tests cover HMAC tampering, expiry, request binding, identity, disabled users and route ownership. Integration tests cover Portal signature isolation and preserving the original listing Agent alongside existing delivery invariants. Browser tests use mocked APIs and cannot prove the production authentication bridge.

Deploy the receiver and worker from the same tested image with the additive migration applied. Install matching secrets and company configuration. After approval, configure the narrow EasyAuth exception, then verify unsigned requests return application 401 and signed owner requests work. Never consider a Microsoft login redirect a successful API response. Exercise the Portal with a real active Agent before enabling user publishing. Existing environment allowlists still govern self-tests.

Rollback: revert web and worker images and remove only the newly added EasyAuth exclusion if it was applied. Leave additive nullable columns and audit records intact. Pause Homix campaigns before changing workers if any have already been published; do not duplicate or blindly retry uncertain deliveries.

## Production deployment record (2026-09-10 New York)

Web and worker use immutable image `acrhomixmktg4flyitmde.azurecr.io/homix-marketing@sha256:270219392c86b07c593291d3395f7e76ce5858c2f344b230310caca7a5836b39`. ACR build `cje` and additive migration execution `caj-homix-mkt-dev-migrate-j6f6axq` succeeded. Web `/health/ready` returned 200 and the worker is running. The integration signing value is stored in Key Vault as `homix-portal-integration-secret`, exposed by the existing user-assigned identity through Container App secret `homix-portal-signing`.

Future infrastructure deployments must supply `USE_HOMIX_PORTAL_INTEGRATION=true` and `HOMIX_PORTAL_COMPANIES_JSON` with the map above. Both GitHub deployment workflows forward these environment variables into Bicep, including production what-if. The integration defaults to disabled for unconfigured environments. Configure these variables in the GitHub environment used for this live service before running a full infrastructure deployment; the current production rollout used the Azure CLI and preserved all existing unrelated settings.

Prior web/worker image for rollback: `acrhomixmktg4flyitmde.azurecr.io/homix-marketing:16d0278debdd489dafd5de253c1b4ba46311b3f9`. Do not remove additive columns or audit records on rollback. Real signed Portal acceptance passed for Admin Homix: MLS search, draft creation/save, HTML preview and nearby audience calculation (119 eligible Agents, zero suppressed). No real email was sent. The current test address is not on the existing self-test allowlist, so self-test and publish remain disabled for that account until intentionally configured.

The final acceptance fix casts Prisma's numeric Portal Agent parameter to `integer` for PostgreSQL's two-argument advisory lock. Real PostgreSQL route regression tests cover concurrent provisioning and disabled mapped users (2 passed). Current web/worker digest: `sha256:ceb4c27271a8c45f15bddb7119c6a587a71efe958319e1418d3c32a753236ba5`, ACR run `cjf` succeeded. Ready revisions: web `--0000020`, worker `--0000018`. Migration still uses the original migration image; no further schema change was needed.

Latest extraction release: ACR run cjh succeeded with image sha256:7417eb2091164725ac2518f3bd85cc7152c167c0547beb69883a786e8663ca7d (tag homix-poster-highlights-20260911). Both web and worker now use this immutable image with existing configuration preserved. Ready revisions are web --0000021 and worker --0000019. Real signed UI extraction succeeded from the Portal and returned source-linked English/Chinese points plus annual tax and monthly management fee. No additional database migration is required. This supersedes the earlier cjf release; its digest above remains the immediate rollback image.

## Independent Content Studio services

The Portal now queries the official website's private listing API (the same BBO provider as Share Center) and calls its own configured Azure text deployment for poster selling-point extraction. These flows do not call this service. Existing listing and poster-highlights endpoints remain for compatibility; all remain signed. This release changes no database schema, EasyAuth exceptions, sender configuration or delivery settings. Self-test validation compares the actual contact email, not the internal principal namespace key.
