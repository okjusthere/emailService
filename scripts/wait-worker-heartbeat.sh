#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 RESOURCE_GROUP WORKER_APP" >&2
  exit 2
fi

readonly resource_group="$1"
readonly worker_app="$2"

for _ in {1..18}; do
  worker_logs="$(az containerapp logs show --only-show-errors \
    --resource-group "${resource_group}" \
    --name "${worker_app}" \
    --type console \
    --tail 100 2>/dev/null || true)"
  if [[ "${worker_logs}" == *"Worker heartbeat updated"* ]]; then
    echo "Worker heartbeat verified: ${worker_app}"
    exit 0
  fi
  sleep 10
done

echo "Worker heartbeat was not observed within three minutes: ${worker_app}" >&2
exit 1
