#!/usr/bin/env bash
# Run the full integration suite locally against a REAL Postgres, mirroring CI.
#
#   pnpm test:integration
#
# What it does:
#   1. Starts the Postgres service from docker-compose.yml (nothing else).
#   2. Ensures a dedicated `pantry_test` database (never touches dev `pantry`).
#   3. Runs the Go recipe-service <-> Postgres tests (they TRUNCATE freely).
#   4. Builds the recipe-service and runs the Convex <-> recipe-service contract
#      tests against it, backed by that same Postgres.
#
# Requires Docker + Go + pnpm. If you only want the cross-service contract
# without infrastructure, run `pnpm --filter @pantry/convex test:integration`
# directly — the service falls back to its in-memory store when no DB is set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Host port 5433 -> container 5432 (see docker-compose.yml).
PG_HOST_PORT="${PG_HOST_PORT:-5433}"
TEST_DB="${TEST_DB:-pantry_test}"
export PANTRY_TEST_DATABASE_URL="postgres://pantry:pantry@localhost:${PG_HOST_PORT}/${TEST_DB}?sslmode=disable"

# compose interpolates every `${VAR:?...}` in the file even when we start a
# single service, so provide throwaway values for the ones unrelated to Postgres.
export RECIPE_SERVICE_SECRET="${RECIPE_SERVICE_SECRET:-integration-test-secret}"
export CONVEX_INSTANCE_SECRET="${CONVEX_INSTANCE_SECRET:-integration-not-used}"

echo "==> Starting Postgres"
docker compose up -d postgres

echo "==> Waiting for Postgres to be healthy"
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q postgres)" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy" >&2; exit 1; }

echo "==> Ensuring ${TEST_DB} database"
docker compose exec -T postgres sh -c \
  "psql -U pantry -tc \"SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'\" | grep -q 1 \
   || createdb -U pantry ${TEST_DB}"

echo "==> Go: recipe-service <-> Postgres tests"
( cd apps/recipe-service && go test -race ./... )

echo "==> Building recipe-service binary"
BIN="$(mktemp -d)/recipe-service"
( cd apps/recipe-service && go build -o "$BIN" ./cmd/server )
export RECIPE_SERVICE_BIN="$BIN"

echo "==> Convex: recipe-service contract tests (against Postgres)"
pnpm --filter @pantry/convex test:integration

echo "==> Integration suite passed"
