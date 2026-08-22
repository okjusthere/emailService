#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "Usage: $0 APP_DISPLAY_NAME REDIRECT_BASE_URL [KEY_VAULT_NAME] [RESOURCE_GROUP]" >&2
  exit 2
fi
readonly display_name="$1"
readonly redirect_base="${2%/}"
readonly key_vault_name="${3:-}"
readonly resource_group="${4:-}"
tenant_id="$(az account show --query tenantId -o tsv)"
client_id="$(az ad app list --display-name "${display_name}" --query '[0].appId' -o tsv)"
if [[ -z "${client_id}" ]]; then
  client_id="$(az ad app create --display-name "${display_name}" --sign-in-audience AzureADMyOrg --web-redirect-uris "${redirect_base}/.auth/login/aad/callback" --query appId -o tsv)"
fi
object_id="$(az ad app show --id "${client_id}" --query id -o tsv)"
az ad app update --id "${object_id}" --web-redirect-uris "${redirect_base}/.auth/login/aad/callback" >/dev/null
az ad sp show --id "${client_id}" >/dev/null 2>&1 || az ad sp create --id "${client_id}" >/dev/null

if [[ -n "${key_vault_name}" ]]; then
  [[ -n "${resource_group}" ]] || { echo "RESOURCE_GROUP is required with KEY_VAULT_NAME." >&2; exit 2; }
  command -v jq >/dev/null || { echo "Missing required command: jq" >&2; exit 1; }
  credential="$(az ad app credential reset --id "${object_id}" --append --display-name homix-container-apps --years 1 --query password -o tsv)"
  secret_document="$(mktemp)"
  chmod 600 "${secret_document}"
  cleanup() { rm -f "${secret_document}"; }
  trap cleanup EXIT
  jq -n --arg value "${credential}" '{properties:{value:$value}}' > "${secret_document}"
  unset credential
  subscription_id="$(az account show --only-show-errors --query id -o tsv)"
  az rest --only-show-errors \
    --method put \
    --url "https://management.azure.com/subscriptions/${subscription_id}/resourceGroups/${resource_group}/providers/Microsoft.KeyVault/vaults/${key_vault_name}/secrets/entra-client-secret?api-version=2023-07-01" \
    --body "@${secret_document}" \
    --output none
  echo "A one-year Easy Auth credential was stored in Key Vault; schedule rotation before expiry."
fi

echo "Tenant ID: ${tenant_id}"
echo "Client ID: ${client_id}"
echo "Redirect URI: ${redirect_base}/.auth/login/aad/callback"
echo "No Microsoft Graph application permissions were granted."
if [[ -n "${resource_group}" ]]; then echo "Re-run the main Bicep deployment for resource group ${resource_group} with these identifiers."; fi
