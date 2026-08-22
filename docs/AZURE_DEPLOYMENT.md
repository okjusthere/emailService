# Azure deployment

Canonical deployment uses `infra/*.bicep`, `scripts/provision-azure.sh` and the deployment workflows. `azure.yaml` is metadata only because azd does not provide the required shared-image migration sequencing.

## Prerequisites and values

Install Azure CLI/Bicep, Git, OpenSSL, curl and Docker if not using ACR Build. Select the intended subscription:

```bash
az login
az account set --subscription REQUIRED_SUBSCRIPTION_ID
az account show --query '{subscription:id,tenant:tenantId,user:user.name}'
az bicep version
```

Create/reuse the single-tenant Entra application first so its non-secret IDs can be placed in the parameter file:

```bash
./scripts/configure-entra.sh \
  'Homix Marketing Production' \
  'https://marketing.homixny.com'
```

Copy, do not edit, the tracked example, then fill the printed tenant/client IDs:

```bash
cp infra/dev.example.bicepparam infra/dev.local.bicepparam
```

`*.local.bicepparam` is ignored. Fill tenant/client IDs, admin emails and stable base URL. Do not put PostgreSQL, Resend or Entra secrets in the file.

Required external inputs are Azure subscription/tenant/resource groups, Entra app ID and allowed users, `marketing.homixny.com`, Resend domain/API/Webhook values, legal postal address, alert recipient, deployment tier/HA and optional brand assets.

## Validate without deploying

```bash
az bicep build --file infra/bootstrap.bicep
az bicep build --file infra/main.bicep
```

The main template creates PostgreSQL 16 on a delegated private subnet, Container Apps environment, Web/Worker/Migration, ACR pull and Blob/Key Vault managed-identity roles, Key Vault and private endpoint, public immutable marketing assets plus a private exports container, Application Insights/Log Analytics and an optional 5xx alert.

`deploymentTier=starter` is the cost-controlled default in every environment: Burstable PostgreSQL, no HA, LRS Blob storage, Web 1–2 and Worker 1 replica. `deploymentTier=production` selects General Purpose PostgreSQL and Web 1–3, but still does not silently enable zone-redundant HA, geo-redundant backup or GRS storage. Enable those explicitly with `enableZoneRedundantHa`, `enableGeoRedundantBackup` and `storageSkuName` after reviewing regional support and cost. Backup retention (7–35 days), all VNet/subnet CIDRs, and Web/Worker replica bounds are parameters.

## First dev/prod provision

```bash
chmod +x scripts/*.sh
./scripts/provision-azure.sh \
  --environment dev \
  --location eastus2 \
  --resource-group rg-homix-mkt-dev-eastus2 \
  --parameters-file infra/dev.local.bicepparam
```

For production use `--environment prod`, the production resource group and a local copy of `infra/prod.example.bicepparam`. The script:

1. deploys `infra/bootstrap.bicep` at subscription scope to create the resource group and ACR;
2. builds `homix-marketing:<git-sha>` in ACR;
3. generates a PostgreSQL password in memory unless `HOMIX_POSTGRES_ADMIN_PASSWORD` is set;
4. deploys `infra/main.bicep` with delivery and optional provider/Entra secret references disabled, while storing the generated database/session secrets in Key Vault;
5. starts and waits for the migration job, which applies Prisma migrations and the idempotent production seed;
6. verifies public readiness and observes a database-backed Worker heartbeat before printing only non-secret resource names.

The generated password is not printed. If the provision process is interrupted, retrieve/reset it using the approved Azure recovery procedure; never paste it into a tracked file.

## Entra Easy Auth

The script creates/reuses a single-tenant app and service principal, configures `/.auth/login/aad/callback`, and grants no Graph application permissions. Tenant admins may perform the same operations manually if CLI permissions are unavailable.

Configure `BOOTSTRAP_ADMIN_EMAILS`; leave `AUTO_PROVISION_USERS=false` unless Homix explicitly chooses domain-restricted VIEWER provisioning. Easy Auth excludes only health, Webhook, unsubscribe and local public assets. The app still authenticates and authorizes every `/api/v2/*` request.

After first provision prints the private Key Vault name, run the same command with Vault/resource group. It writes the generated credential through the Azure Resource Manager control plane, so Key Vault remains private-network-only:

```bash
./scripts/configure-entra.sh \
  'Homix Marketing Production' \
  'https://marketing.homixny.com' \
  REQUIRED_KEY_VAULT_NAME \
  rg-homix-mkt-prod-eastus2
```

Re-run the main deployment through `deploy-release.sh` with `USE_ENTRA_CLIENT_SECRET=true`; only that revision enables the secret reference.

## Resend and Key Vault

Create secrets with the interactive ARM control-plane helper; values are read without echo, written through a mode-0600 temporary document and never placed in shell history:

```bash
./scripts/set-key-vault-secret.sh rg-homix-mkt-prod-eastus2 REQUIRED_KEY_VAULT_NAME resend-api-key
./scripts/set-key-vault-secret.sh rg-homix-mkt-prod-eastus2 REQUIRED_KEY_VAULT_NAME resend-webhook-secret
```

Configure Resend Webhook URL:

```text
https://marketing.homixny.com/api/public/webhooks/resend
```

Subscribe to sent/delivered/delivery-delayed/failed/bounced/complained/suppressed/opened/clicked events. For rotation, write the old value as `resend-webhook-previous-secret`, deploy with `USE_PREVIOUS_RESEND_WEBHOOK_SECRET=true` plus an ISO `RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT`, then set the flag false after the overlap and verification.

## DNS and custom domain

First verify `listings.homixny.com` in Resend and publish its current SPF/DKIM/tracking records without overwriting the organization's existing DMARC policy. Then bind the management domain:

```bash
./scripts/configure-custom-domain.sh \
  rg-homix-mkt-prod-eastus2 \
  ca-homix-mkt-prod-web \
  cae-homix-mkt-prod \
  marketing.homixny.com
```

The script prints the required CNAME/TXT, waits for operator confirmation, verifies DNS, provisions an Azure managed certificate, binds it and performs an HTTPS health check. If managed-certificate issuance is unavailable, upload an organization-approved PFX with `az containerapp env certificate upload --resource-group REQUIRED_RESOURCE_GROUP --name REQUIRED_ENVIRONMENT --certificate-file REQUIRED_PFX --certificate-password`, capture its resource ID, then run `az containerapp hostname bind ... --certificate REQUIRED_CERTIFICATE_ID`. Keep the PFX/password outside the repository and shell history. Set `BASE_URL` to the final domain before sandbox/live sending.

Azure Monitor must also alert on the structured log events `Job failed`, `deliverability_threshold_exceeded` and `batch_failed`, plus absence of `Worker heartbeat updated` for ten minutes and repeated `/health/ready` failures. Route those scheduled-query alerts to the same action group created by `alertEmail`; the exact KQL fields should first be confirmed against one deployment's `ContainerAppConsoleLogs_CL` schema because Azure workspace column names vary by ingestion mode.

## GitHub OIDC

Create one Azure federated identity per GitHub Environment (`development`, `production`) and grant the deployment principal only the resource-group/ACR permissions required. Add GitHub Environment variables:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_ACR_NAME
ENTRA_CLIENT_ID
HOMIX_BASE_URL
BOOTSTRAP_ADMIN_EMAILS
COMPANY_POSTAL_ADDRESS
ALERT_EMAIL
DEPLOYMENT_TIER
ENABLE_ZONE_REDUNDANT_HA
POSTGRES_BACKUP_RETENTION_DAYS
ENABLE_GEO_REDUNDANT_BACKUP
STORAGE_SKU_NAME
USE_RESEND_SECRETS
USE_PREVIOUS_RESEND_WEBHOOK_SECRET
RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT
USE_ENTRA_CLIENT_SECRET
EMAIL_DELIVERY_MODE
```

No Azure client secret is required by GitHub. Protect `production` with required reviewers. `deploy-prod.yml` is manual or `v*` tag driven, stores Bicep what-if as an artifact, and uses an immutable SHA/version tag.

## Subsequent release

After CI/security pass and the SHA image exists:

```bash
export AZURE_ACR_NAME=REQUIRED_ACR
export ENTRA_TENANT_ID=REQUIRED_TENANT
export ENTRA_CLIENT_ID=REQUIRED_ENTRA_APP
export HOMIX_BASE_URL=https://marketing.homixny.com
export BOOTSTRAP_ADMIN_EMAILS=REQUIRED_EMAILS
export COMPANY_POSTAL_ADDRESS='REQUIRED_REAL_ADDRESS'
export ALERT_EMAIL=REQUIRED_ALERT_EMAIL
export DEPLOYMENT_TIER=production
export ENABLE_ZONE_REDUNDANT_HA=false
export POSTGRES_BACKUP_RETENTION_DAYS=14
export ENABLE_GEO_REDUNDANT_BACKUP=false
export STORAGE_SKU_NAME=Standard_LRS
export USE_RESEND_SECRETS=true
export USE_ENTRA_CLIENT_SECRET=true
export EMAIL_DELIVERY_MODE=disabled

./scripts/deploy-release.sh \
  rg-homix-mkt-prod-eastus2 \
  prod \
  REQUIRED_ACR.azurecr.io/homix-marketing:REQUIRED_GIT_SHA
```

The script preserves current Web/Worker images during the Bicep update, changes/runs migration first, waits for success, updates Web and checks liveness, readiness, auth protection, unsubscribe rendering and invalid-webhook rejection, then updates Worker and waits for its database-backed heartbeat log. A migration, smoke or heartbeat failure stops the rollout. It writes `deployment-summary.md`, publishes it to the GitHub job summary/artifacts, and prints application-only rollback commands; database migrations are not automatically rolled back.

## Live enable checklist

Keep disabled until all are true: legal address, stable HTTPS base URL, verified From domain/SPF/DKIM, DMARC reviewed, tracking decision made, Reply-To tested, Webhook signature/event verified, worker heartbeat fresh, migrations current, sender verified, test allowlist send successful, suppression/unsubscribe smoke passed, recovery guard reconciled and Admin resume reason audited. Begin in `sandbox`, send a small canary, then deploy a revision with `EMAIL_DELIVERY_MODE=live`.
