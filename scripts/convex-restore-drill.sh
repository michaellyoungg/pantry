#!/usr/bin/env bash
# Restore drill for self-hosted Convex (BL-0008).
#
#   scripts/convex-restore-drill.sh
#
# A backup you have never restored is a hypothesis. This script is the
# experiment: it stands up a throwaway Postgres-backed Convex deployment, puts
# known data in it, backs it up, DESTROYS the deployment and its volumes,
# rebuilds it empty, restores, and then fails loudly unless every document came
# back byte-for-byte (modulo the _id/_creationTime an import re-mints).
#
# It also proves the negative: between the destroy and the restore it asserts
# the rebuilt deployment is genuinely empty, so a passing drill cannot be an
# artifact of data that was never actually gone.
#
# Safety. The drill only ever operates on its own compose project
# (`pantry-drill` by default) with its own named volumes and shifted host ports
# — see deploy/docker-compose.drill.yml. It refuses to run under the `pantry`
# project, and the `down -v` it issues is scoped to the drill project, so it
# cannot reach the developer stack's ./.data bind mounts. It is safe to run
# while the normal stack is up.
#
# Run this whenever the backup/restore path changes, and on the upgrade cadence
# in docs/self-hosted-convex-ops.md.
#
# Env knobs:
#   DRILL_PROJECT=pantry-drill   compose project name (must not be `pantry`)
#   DRILL_KEEP_STACK=1           leave the scratch stack up afterwards
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

PROJECT="${DRILL_PROJECT:-pantry-drill}"
[ "$PROJECT" != "pantry" ] ||
  convex_die "DRILL_PROJECT must not be 'pantry' — the drill destroys its own stack"

COMPOSE=(
  docker compose -p "$PROJECT"
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/deploy/docker-compose.convex-postgres.yml"
  -f "$ROOT/deploy/docker-compose.drill.yml"
)

# The scratch backend lives on the shifted ports from the drill override, so a
# mistargeted command fails to connect rather than reaching the real stack.
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3310"
export CONVEX_SELF_HOSTED_URL

# Ephemeral, drill-only secrets. The base compose file requires both to be set
# even though the drill never starts recipe-service.
export CONVEX_INSTANCE_SECRET="${CONVEX_INSTANCE_SECRET:-$(openssl rand -hex 32)}"
export RECIPE_SERVICE_SECRET="${RECIPE_SERVICE_SECRET:-drill-unused}"

WORK="$(mktemp -d)"
cleanup() {
  if [ "${DRILL_KEEP_STACK:-0}" = "1" ]; then
    echo "==> DRILL_KEEP_STACK=1 — leaving the $PROJECT stack up"
  else
    echo "==> tearing down the $PROJECT stack"
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo
  echo "DRILL FAILED: $*" >&2
  exit 1
}

# --- helpers ---------------------------------------------------------------

stack_up() {
  "${COMPOSE[@]}" up -d postgres convex-backend >/dev/null
  convex_wait_ready 180
  unset CONVEX_SELF_HOSTED_ADMIN_KEY
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(convex_admin_key)"
  export CONVEX_SELF_HOSTED_ADMIN_KEY
}

# In a real recovery the functions come from git, not from the snapshot. The
# drill deploys them the same way both times so it exercises that dependency.
deploy_functions() {
  convex_cli dev --once >/dev/null
}

row_count() {
  local zip=$1 table=$2 docs
  docs="$(convex_table_docs "$zip" "$table")"
  [ -z "$docs" ] && echo 0 || printf '%s\n' "$docs" | wc -l | tr -d ' '
}

# --- 0. known seed data ----------------------------------------------------
# scripts/fixtures/convex-drill/<table>.json — see the README there.

TABLES="groceryList pantryItems"
SEED_DIR="$ROOT/scripts/fixtures/convex-drill"

echo "==> [1/8] starting scratch stack ($PROJECT, Postgres-backed, port 3310)"
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
stack_up

# Prove the backing store really is Postgres and not a silent SQLite fallback —
# the whole point of the exercise is to drill the configuration we intend to run.
if ! "${COMPOSE[@]}" exec -T postgres psql -U pantry -d convex_self_hosted -c '\dt' 2>/dev/null | grep -q documents; then
  fail "convex_self_hosted has no 'documents' table — the backend fell back to SQLite"
fi
echo "    backing store confirmed: Postgres (convex_self_hosted.documents present)"

echo "==> [2/8] deploying functions + schema"
deploy_functions

echo "==> [3/8] seeding known data"
for t in $TABLES; do
  convex_cli import --table "$t" --replace --yes --format jsonArray "$SEED_DIR/$t.json" >/dev/null
done

echo "==> [4/8] taking a backup"
"$ROOT/scripts/convex-backup.sh" --out "$WORK/backups" --keep 5
BACKUP="$(ls -1d "$WORK"/backups/20* | tail -n1)/snapshot.zip"
[ -f "$BACKUP" ] || fail "backup script produced no snapshot"

for t in $TABLES; do
  before="$(row_count "$BACKUP" "$t")"
  echo "    snapshot contains $before $t rows"
  [ "$before" -gt 0 ] || fail "snapshot captured 0 rows for $t"
done

echo "==> [5/8] DESTROYING the deployment (containers + volumes)"
"${COMPOSE[@]}" down -v >/dev/null
for v in "${PROJECT}_drill-postgres" "${PROJECT}_drill-convex"; do
  if docker volume inspect "$v" >/dev/null 2>&1; then
    fail "volume $v survived 'down -v' — the destroy step did not actually destroy"
  fi
done
echo "    volumes ${PROJECT}_drill-postgres and ${PROJECT}_drill-convex are gone"

echo "==> [6/8] rebuilding empty + redeploying functions from source"
stack_up
deploy_functions

convex_cli export --include-file-storage --path "$WORK/empty.zip" >/dev/null
for t in $TABLES; do
  n="$(row_count "$WORK/empty.zip" "$t")"
  [ "$n" = "0" ] || fail "rebuilt deployment already has $n $t rows — it was not really destroyed"
done
echo "    confirmed empty: 0 rows in every drilled table"

echo "==> [7/8] restoring the snapshot"
"$ROOT/scripts/convex-restore.sh" "$BACKUP" --yes

echo "==> [8/8] verifying the data came back"
convex_cli export --include-file-storage --path "$WORK/after.zip" >/dev/null
for t in $TABLES; do
  if ! diff <(convex_table_docs "$BACKUP" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >/dev/null; then
    echo "--- mismatch in $t ---" >&2
    diff <(convex_table_docs "$BACKUP" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >&2 || true
    fail "restored $t does not match the snapshot"
  fi
  echo "    $t: $(row_count "$WORK/after.zip" "$t")/$(row_count "$BACKUP" "$t") rows restored, contents identical"
done

echo
echo "DRILL PASSED — backup, destroy, restore, verify all succeeded."
