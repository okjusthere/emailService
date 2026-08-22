#!/usr/bin/env bash
set -euo pipefail

readonly TEST_DATABASE_NAME="homix_marketing_test"
readonly INTEGRATION_DATABASE_URL="postgresql://homix:homix@localhost:${POSTGRES_PORT:-5434}/${TEST_DATABASE_NAME}?schema=public"

drop_test_database() {
  docker compose exec -T postgres dropdb -U homix --if-exists "${TEST_DATABASE_NAME}" >/dev/null 2>&1 || true
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  drop_test_database
  exit "${exit_code}"
}
trap on_exit EXIT

docker compose up -d --wait postgres
drop_test_database
docker compose exec -T postgres createdb -U homix "${TEST_DATABASE_NAME}"

TEST_DATABASE_URL="${INTEGRATION_DATABASE_URL}" DATABASE_URL="${INTEGRATION_DATABASE_URL}" DIRECT_DATABASE_URL="${INTEGRATION_DATABASE_URL}" \
  ./node_modules/.bin/prisma migrate deploy
TEST_DATABASE_URL="${INTEGRATION_DATABASE_URL}" DATABASE_URL="${INTEGRATION_DATABASE_URL}" DIRECT_DATABASE_URL="${INTEGRATION_DATABASE_URL}" \
  ./node_modules/.bin/tsx prisma/seed.ts
TEST_DATABASE_URL="${INTEGRATION_DATABASE_URL}" DATABASE_URL="${INTEGRATION_DATABASE_URL}" DIRECT_DATABASE_URL="${INTEGRATION_DATABASE_URL}" \
  ./node_modules/.bin/tsx prisma/seed.ts
TEST_DATABASE_URL="${INTEGRATION_DATABASE_URL}" TEST_DELIVERY_MODE="disabled" \
  ./node_modules/.bin/vitest run tests/integration --no-file-parallelism "$@"
