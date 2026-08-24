#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 RESOURCE_GROUP ENVIRONMENT NEW_IMAGE" >&2
  exit 2
fi
readonly resource_group="$1"
readonly environment_name="$2"
readonly new_image="$3"
readonly web_app="ca-homix-mkt-${environment_name}-web"
readonly worker_app="ca-homix-mkt-${environment_name}-worker"
readonly migration_job="caj-homix-mkt-${environment_name}-migrate"

current_web_image="$(az containerapp show --resource-group "${resource_group}" --name "${web_app}" --query properties.template.containers[0].image -o tsv)"
current_worker_image="$(az containerapp show --resource-group "${resource_group}" --name "${worker_app}" --query properties.template.containers[0].image -o tsv)"
: "${AZURE_ACR_NAME:?AZURE_ACR_NAME is required}"
: "${ENTRA_TENANT_ID:?ENTRA_TENANT_ID is required}"
: "${ENTRA_CLIENT_ID:?ENTRA_CLIENT_ID is required}"
: "${HOMIX_BASE_URL:?HOMIX_BASE_URL is required}"
: "${BOOTSTRAP_ADMIN_EMAILS:?BOOTSTRAP_ADMIN_EMAILS is required}"

az deployment group create --only-show-errors \
  --resource-group "${resource_group}" \
  --name "homix-release-${environment_name}-${GITHUB_RUN_ID:-local}" \
  --template-file infra/main.bicep \
  --parameters environment="${environment_name}" deploymentTier="${DEPLOYMENT_TIER:-starter}" enableZoneRedundantHa="${ENABLE_ZONE_REDUNDANT_HA:-false}" postgresBackupRetentionDays="${POSTGRES_BACKUP_RETENTION_DAYS:-7}" enableGeoRedundantBackup="${ENABLE_GEO_REDUNDANT_BACKUP:-false}" storageSkuName="${STORAGE_SKU_NAME:-Standard_LRS}" acrName="${AZURE_ACR_NAME}" entraTenantId="${ENTRA_TENANT_ID}" entraClientId="${ENTRA_CLIENT_ID}" baseUrl="${HOMIX_BASE_URL}" bootstrapAdminEmails="${BOOTSTRAP_ADMIN_EMAILS}" companyPostalAddress="${COMPANY_POSTAL_ADDRESS:-REQUIRED_BEFORE_LIVE_SEND}" alertEmail="${ALERT_EMAIL:-}" useResendSecrets="${USE_RESEND_SECRETS:-false}" useEntraClientSecret="${USE_ENTRA_CLIENT_SECRET:-false}" emailDeliveryMode="${EMAIL_DELIVERY_MODE:-disabled}" emailTestAllowlist="${EMAIL_TEST_ALLOWLIST:-}" \
  --parameters containerImage="${new_image}" migrationContainerImage="${new_image}" webContainerImage="${current_web_image}" workerContainerImage="${current_worker_image}" usePreviousResendWebhookSecret="${USE_PREVIOUS_RESEND_WEBHOOK_SECRET:-false}" resendWebhookPreviousSecretExpiresAt="${RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT:-}" usePreviousUnsubscribeSigningSecret="${USE_PREVIOUS_UNSUBSCRIBE_SIGNING_SECRET:-false}" unsubscribePreviousSigningSecretExpiresAt="${UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT:-}" oneKeyProvider="${ONEKEY_PROVIDER:-disabled}" bboListingApiBaseUrl="${BBO_LISTING_API_BASE_URL:-}" useBboMarketingApiKey="${USE_BBO_MARKETING_API_KEY:-false}" useMlsGridAccessToken="${USE_MLS_GRID_ACCESS_TOKEN:-false}" oneKeySyncEnabled="${ONEKEY_SYNC_ENABLED:-false}" aiProvider="${AI_PROVIDER:-disabled}" useOpenAiApiKey="${USE_OPENAI_API_KEY:-false}" openAiModel="${OPENAI_MODEL:-gpt-5-mini}"

execution_name="$(az containerapp job start --resource-group "${resource_group}" --name "${migration_job}" --query name -o tsv)"
for _ in {1..90}; do
  status="$(az containerapp job execution show --resource-group "${resource_group}" --name "${migration_job}" --job-execution-name "${execution_name}" --query properties.status -o tsv)"
  [[ "${status}" == "Succeeded" ]] && break
  [[ "${status}" == "Failed" ]] && { echo "Migration failed; Web and Worker remain on their previous images." >&2; exit 1; }
  sleep 10
done
[[ "${status}" == "Succeeded" ]] || { echo "Migration timed out; rollout stopped." >&2; exit 1; }

az containerapp update --only-show-errors --resource-group "${resource_group}" --name "${web_app}" --image "${new_image}" >/dev/null
fqdn="$(az containerapp show --resource-group "${resource_group}" --name "${web_app}" --query properties.configuration.ingress.fqdn -o tsv)"
curl --fail --silent --show-error --retry 18 --retry-delay 10 "https://${fqdn}/health/ready" >/dev/null
curl --fail --silent --show-error "https://${fqdn}/health/live" >/dev/null
curl --fail --silent --show-error "https://${fqdn}/unsubscribe?token=invalid-smoke-token" >/dev/null
auth_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://${fqdn}/api/v2/auth/me")"
[[ "${auth_status}" =~ ^(302|401|403)$ ]] || { echo "Authenticated API smoke check unexpectedly returned ${auth_status}." >&2; exit 1; }
webhook_status="$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'svix-id: deploy-smoke-invalid' -H 'svix-timestamp: 1' -H 'svix-signature: invalid' --data '{}' "https://${fqdn}/api/public/webhooks/resend")"
[[ "${webhook_status}" =~ ^(400|401)$ ]] || { echo "Webhook signature smoke check unexpectedly returned ${webhook_status}." >&2; exit 1; }
az containerapp update --only-show-errors --resource-group "${resource_group}" --name "${worker_app}" --image "${new_image}" >/dev/null
bash scripts/wait-worker-heartbeat.sh "${resource_group}" "${worker_app}"

{
  echo "# Homix deployment summary"
  echo
  echo "- Environment: ${environment_name}"
  echo "- Resource group: ${resource_group}"
  echo "- Image: ${new_image}"
  echo "- Migration: ${execution_name} (${status})"
  echo "- Web: https://${fqdn} (live/ready/auth/unsubscribe/webhook guard smoke checks passed)"
  echo "- Worker: heartbeat observed"
} > deployment-summary.md
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  sed -n '1,20p' deployment-summary.md >> "${GITHUB_STEP_SUMMARY}"
fi

echo "Release complete: ${new_image}"
echo "Rollback applications only:"
echo "az containerapp update -g ${resource_group} -n ${web_app} --image ${current_web_image}"
echo "az containerapp update -g ${resource_group} -n ${worker_app} --image ${current_worker_image}"
