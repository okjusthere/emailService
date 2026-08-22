#!/usr/bin/env bash
set -euo pipefail

readonly E2E_DATABASE_NAME="homix_marketing_e2e"
readonly E2E_DATABASE_URL="postgresql://homix:homix@localhost:${POSTGRES_PORT:-5434}/${E2E_DATABASE_NAME}?schema=public"

drop_e2e_database() {
  docker compose exec -T postgres dropdb -U homix --if-exists "${E2E_DATABASE_NAME}" >/dev/null 2>&1 || true
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  drop_e2e_database
  exit "${exit_code}"
}
trap on_exit EXIT

docker compose up -d --wait postgres
drop_e2e_database
docker compose exec -T postgres createdb -U homix "${E2E_DATABASE_NAME}"

DATABASE_URL="${E2E_DATABASE_URL}" DIRECT_DATABASE_URL="${E2E_DATABASE_URL}" \
  ./node_modules/.bin/prisma migrate deploy
DATABASE_URL="${E2E_DATABASE_URL}" DIRECT_DATABASE_URL="${E2E_DATABASE_URL}" \
  ./node_modules/.bin/tsx prisma/seed.ts
DATABASE_URL="${E2E_DATABASE_URL}" DIRECT_DATABASE_URL="${E2E_DATABASE_URL}" \
  ./node_modules/.bin/playwright test
