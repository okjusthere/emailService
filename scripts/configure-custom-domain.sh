#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 RESOURCE_GROUP CONTAINER_APP CONTAINER_APPS_ENVIRONMENT CUSTOM_DOMAIN" >&2
  exit 2
fi
readonly resource_group="$1"
readonly app_name="$2"
readonly environment_name="$3"
readonly custom_domain="$4"
fqdn="$(az containerapp show -g "${resource_group}" -n "${app_name}" --query properties.configuration.ingress.fqdn -o tsv)"
verification_id="$(az containerapp env show -g "${resource_group}" -n "${environment_name}" --query properties.customDomainConfiguration.customDomainVerificationId -o tsv)"

echo "Create and verify these DNS records before continuing:"
echo "CNAME ${custom_domain} -> ${fqdn}"
echo "TXT asuid.${custom_domain} -> ${verification_id}"
read -r -p "Press Enter after DNS has propagated, or Ctrl-C to stop. "
dig +short CNAME "${custom_domain}" | grep -qi "${fqdn%.}" || { echo "CNAME is not visible yet." >&2; exit 1; }

az containerapp hostname add -g "${resource_group}" -n "${app_name}" --hostname "${custom_domain}"
certificate_id="$(az containerapp env certificate create -g "${resource_group}" -n "${environment_name}" --hostname "${custom_domain}" --validation-method CNAME --query id -o tsv)"
az containerapp hostname bind -g "${resource_group}" -n "${app_name}" --hostname "${custom_domain}" --certificate "${certificate_id}"
curl --fail --silent --show-error --retry 12 --retry-delay 10 "https://${custom_domain}/health/live" >/dev/null
echo "Custom domain ready: https://${custom_domain}"
