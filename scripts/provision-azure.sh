#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --environment dev|prod --location eastus2 --resource-group NAME --parameters-file FILE" >&2
  exit 2
}

environment_name=""
location=""
resource_group=""
parameters_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) environment_name="${2:-}"; shift 2 ;;
    --location) location="${2:-}"; shift 2 ;;
    --resource-group) resource_group="${2:-}"; shift 2 ;;
    --parameters-file) parameters_file="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "${environment_name}" == "dev" || "${environment_name}" == "prod" ]] || usage
[[ -n "${location}" && -n "${resource_group}" && -f "${parameters_file}" ]] || usage
for command_name in az git openssl curl; do command -v "${command_name}" >/dev/null || { echo "Missing required command: ${command_name}" >&2; exit 1; }; done
az account show --only-show-errors >/dev/null
az bicep version >/dev/null

git_sha="$(git rev-parse --verify HEAD)"
bootstrap_name="homix-bootstrap-${environment_name}-${git_sha:0:8}"
bootstrap_json="$(az deployment sub create --only-show-errors --name "${bootstrap_name}" --location "${location}" --template-file infra/bootstrap.bicep --parameters environment="${environment_name}" resourceGroupName="${resource_group}" location="${location}" -o json)"
acr_name="$(az deployment sub show --only-show-errors --name "${bootstrap_name}" --query properties.outputs.acrName.value -o tsv)"
acr_login_server="$(az deployment sub show --only-show-errors --name "${bootstrap_name}" --query properties.outputs.acrLoginServer.value -o tsv)"
: "${bootstrap_json:?Bootstrap deployment returned no result}"

image_tag="${acr_login_server}/homix-marketing:${git_sha}"
az acr build --only-show-errors --registry "${acr_name}" --image "homix-marketing:${git_sha}" .

postgres_password="${HOMIX_POSTGRES_ADMIN_PASSWORD:-$(openssl rand -base64 36 | tr -d '\n')}"
main_name="homix-main-${environment_name}-${git_sha:0:8}"
az deployment group create --only-show-errors \
  --name "${main_name}" \
  --resource-group "${resource_group}" \
  --template-file infra/main.bicep \
  --parameters "${parameters_file}" \
  --parameters containerImage="${image_tag}" acrName="${acr_name}" postgresAdminPassword="${postgres_password}" emailDeliveryMode=disabled useResendSecrets=false useEntraClientSecret=false
unset postgres_password

migration_job="$(az deployment group show --only-show-errors --resource-group "${resource_group}" --name "${main_name}" --query properties.outputs.migrationJobName.value -o tsv)"
web_fqdn="$(az deployment group show --only-show-errors --resource-group "${resource_group}" --name "${main_name}" --query properties.outputs.webFqdn.value -o tsv)"
worker_app="$(az deployment group show --only-show-errors --resource-group "${resource_group}" --name "${main_name}" --query properties.outputs.workerAppName.value -o tsv)"
key_vault_name="$(az deployment group show --only-show-errors --resource-group "${resource_group}" --name "${main_name}" --query properties.outputs.keyVaultName.value -o tsv)"
execution_name="$(az containerapp job start --only-show-errors --resource-group "${resource_group}" --name "${migration_job}" --query name -o tsv)"

for _ in {1..60}; do
  execution_status="$(az containerapp job execution show --only-show-errors --resource-group "${resource_group}" --name "${migration_job}" --job-execution-name "${execution_name}" --query properties.status -o tsv)"
  [[ "${execution_status}" == "Succeeded" ]] && break
  [[ "${execution_status}" == "Failed" ]] && { echo "Migration job failed: ${execution_name}" >&2; exit 1; }
  sleep 10
done
[[ "${execution_status}" == "Succeeded" ]] || { echo "Migration job did not finish within 10 minutes." >&2; exit 1; }

curl --fail --silent --show-error --retry 12 --retry-delay 10 "https://${web_fqdn}/health/ready" >/dev/null
bash scripts/wait-worker-heartbeat.sh "${resource_group}" "${worker_app}"
echo "Provisioned ${resource_group}"
echo "Image: ${image_tag}"
echo "Web: https://${web_fqdn}"
echo "Worker: ${worker_app}"
echo "Key Vault: ${key_vault_name}"
echo "Delivery remains disabled. Complete Entra, Resend, DNS, and live-readiness checks before enabling it."
