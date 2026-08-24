#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 RESOURCE_GROUP KEY_VAULT_NAME SECRET_NAME" >&2
  exit 2
fi

readonly resource_group="$1"
readonly key_vault_name="$2"
readonly secret_name="$3"
[[ "${secret_name}" =~ ^[A-Za-z0-9-]+$ ]] || { echo "Invalid Key Vault secret name." >&2; exit 2; }
for command_name in az jq; do
  command -v "${command_name}" >/dev/null || { echo "Missing required command: ${command_name}" >&2; exit 1; }
done

secret_document="$(mktemp)"
chmod 600 "${secret_document}"
cleanup() { rm -f "${secret_document}"; }
trap cleanup EXIT

IFS= read -r -s -p "Enter ${secret_name}: " secret_value
echo
if [[ -z "${secret_value}" ]]; then
  echo "Secret value cannot be empty." >&2
  exit 2
fi
if [[ "${secret_name}" == "resend-api-key" && ! "${secret_value}" =~ ^re_[A-Za-z0-9_]+$ ]]; then
  echo "Invalid Resend API key. Paste the raw re_... value without spaces, backslashes, or terminal editing keys." >&2
  exit 2
fi
jq -n --arg value "${secret_value}" '{properties:{value:$value}}' > "${secret_document}"
unset secret_value

subscription_id="$(az account show --only-show-errors --query id -o tsv)"
az rest --only-show-errors \
  --method put \
  --url "https://management.azure.com/subscriptions/${subscription_id}/resourceGroups/${resource_group}/providers/Microsoft.KeyVault/vaults/${key_vault_name}/secrets/${secret_name}?api-version=2023-07-01" \
  --body "@${secret_document}" \
  --output none
echo "Secret stored through Azure Resource Manager: ${key_vault_name}/${secret_name}"
