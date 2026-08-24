# Security and compliance

## Trust boundaries

- Azure Easy Auth is the production identity perimeter, but application middleware still resolves a database user and enforces RBAC. Browser-supplied role headers are never trusted.
- Production startup rejects `AUTH_MODE=local`, `DEV_BYPASS_AUTH=true`, non-TLS PostgreSQL, local asset storage, placeholder unsubscribe secrets, incomplete enabled BBO/OpenAI configuration, missing provider configuration for Worker sandbox/live, localhost live URLs and placeholder postal address.
- Web, Worker and Migration are separate processes with the same non-root image. Only Worker may call the email provider; only Migration runs schema deploy.
- Key Vault references and a user-assigned managed identity supply database/provider secrets. Storage uploads use `DefaultAzureCredential`; shared keys are disabled.

## HTTP and content

Helmet sets CSP/security headers; CORS is same-origin; mutation CSRF, body limits and route-specific rate limits are enforced. Public allowlist is deliberately narrow. Error handling returns sanitized messages and structured request IDs without stack traces/secrets in production.

Rich email content and agent signatures pass an allowlist sanitizer. Preview uses a sandboxed iframe. Subject validation rejects newlines/unresolved merge fields; live output requires postal address/unsubscribe and forbids local URLs. Upload validation uses magic bytes, not filename alone; SVG/executable/path traversal inputs are rejected. Sharp decodes, strips metadata and re-encodes images. CSV export prefixes formula-leading cells.

## Email safety

- Stable From profiles; listing Campaign Reply-To and signature are always derived from the listing's assigned Agent and cannot be overridden by Campaign input or sender fallback. No random domain/address rotation.
- `disabled` makes no external call; `sandbox` enforces the allowlist both for test send and campaign recipient processing.
- Live requires verified sender and readiness confirmations. Suppression is global and rechecked immediately before submit.
- Batch attempts are recorded before provider calls. Stable, non-PII HMAC-derived idempotency keys prevent unsafe duplicate retry; uncertain outcomes stop for manual reconciliation.
- Unsubscribe tokens are signed, non-guessable bearer values; only their SHA-256 hash is stored on the recipient. Visible GET is non-mutating, one-click POST is idempotent.
- Unsubscribe signing is independent of session signing. Verification tries the current secret, then a previous secret only until its configured expiry.
- Complaint/hard-bounce/provider suppression has stronger persistence than later engagement events.
- Unmatched Webhooks remain durable and retry on a bounded schedule before dead letter. Uncertain provider submissions require reasoned, audited manual-review actions; safe retry reuses the original provider idempotency window.

## MLS and AI boundaries

OneKey data enters through a server-only provider adapter. The browser never receives the BBO bearer key or MLS Grid token. BBO keys should be dedicated to Homix Marketing and scoped to the read-only listing, event and marketing-recipient routes. Provider errors are sanitized, searches/limits are bounded, and remote media is copied only from the configured provider origin, size-checked, decoded by Sharp and stored under Homix control.

AI receives only an allowlist of listing facts and current marketing fields—never contacts, recipient lists, auth headers or secrets. MLS remarks are explicitly treated as untrusted data, not instructions. The OpenAI/Azure OpenAI adapter uses server-side structured output; Azure key egress is restricted to an HTTPS `*.openai.azure.com/openai/v1` endpoint. Persisted proposals do not overwrite content until a human selects fields and applies them. Generated intro text is HTML-escaped before sanitization. `AI_PROVIDER=disabled` leaves the manual campaign/send path intact, while the deterministic fake provider is clearly marked test-only.

## Data exposure and retention

Contact imports/exports live in the private Blob container; only immutable marketing assets are public. Audit data stores normalized identifiers/metadata needed for accountability, not secrets or full import lists. Cleanup jobs apply configured Webhook/audit retention and keep historical campaign asset references. Logs must never emit API keys, database URLs, raw principal payloads, full recipient lists or message bodies.

PostgreSQL is private-only. Key Vault is private endpoint/RBAC/soft-delete, with purge protection in prod. The public marketing container is an intentional exception required by email clients; private exports remain non-public and all writes are authenticated.

The initial Azure template uses the PostgreSQL administrator for both pooled runtime and direct migration URLs, with separate connection limits and Key Vault references. The specification permits this bootstrap compromise; creating a separate least-privilege runtime role is the next database-hardening step and must be completed before broader organizational tenancy or untrusted SQL-facing features are introduced.

## Secret handling and rotation

`.env` and `*.local.bicepparam` are ignored. `.env.example` contains placeholders only. The source-archive build starts from `git ls-files`, rejects `.env`/secret-like artifacts and CI scans both repository history and the built archive. GitHub deployment uses OIDC; the Entra app credential used by Easy Auth, where required, is independently stored in Key Vault. Security CI runs npm high-severity audit, license policy, Gitleaks history scan, CodeQL and Trivy HIGH/CRITICAL image scanning.

Rotate Resend API/Webhook, unsubscribe signing, BBO, OpenAI and Entra credentials per `OPERATIONS_RUNBOOK.md`. Webhook and unsubscribe adapters support independent current plus time-limited previous secrets. If any historic `.env` or provider key may have been shared, rotate at the source; deleting a local file is not sufficient.

## Verification checklist

- anonymous and VIEWER mutation rejection;
- forged principal header rejection in local and direct production paths;
- CSRF, raw signed/replayed Webhook, rate/body/upload limits;
- HTML/XSS and SVG/path traversal rejection;
- formula-safe exports and non-PII idempotency keys;
- suppression race, quota concurrency and out-of-order Webhooks;
- tracked-file secret scan and production image inspection.

Report suspected vulnerabilities privately to the Homix security/operations owner; pause delivery first if recipient safety or duplicate sends may be affected.
