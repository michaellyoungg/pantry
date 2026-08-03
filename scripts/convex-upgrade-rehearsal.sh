#!/usr/bin/env bash
# Rehearse a Convex image upgrade before changing the pin (BL-0008).
#
#   docker pull ghcr.io/get-convex/convex-backend:latest
#   CONVEX_CANDIDATE_IMAGE="$(docker image inspect \
#     ghcr.io/get-convex/convex-backend:latest --format '{{index .RepoDigests 0}}')" \
#     scripts/convex-upgrade-rehearsal.sh
#
# docker-compose.yml pins the backend by digest, so upgrading is a deliberate
# edit. This script is what makes that edit safe to do: it answers the only
# question that matters — will the new image come up on the OLD image's data?
#
#   1. stand up a scratch stack on the CURRENTLY PINNED image
#   2. seed known data and snapshot it
#   3. recreate convex-backend on the CANDIDATE image, against the same
#      Postgres database and the same data volume
#   4. assert it becomes healthy and every document is still readable, unchanged
#
# Step 3 is the real test. A fresh-database smoke test would pass for an image
# that cannot migrate existing data, which is the failure mode that actually
# costs you a deployment.
#
# Passing here does not make the upgrade risk-free — it exercises this repo's
# schema and a handful of rows, not your whole dataset. Take a backup before
# the real upgrade regardless. See docs/self-hosted-convex-ops.md.
#
# Env knobs:
#   CONVEX_CANDIDATE_IMAGE   (required) image ref to rehearse
#   DRILL_PROJECT=pantry-drill  compose project name (must not be `pantry`)
#   DRILL_KEEP_STACK=1          leave the scratch stack up afterwards
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

[ -n "${CONVEX_CANDIDATE_IMAGE:-}" ] ||
  convex_die "set CONVEX_CANDIDATE_IMAGE to the image ref you want to rehearse"

PROJECT="${DRILL_PROJECT:-pantry-drill}"
[ "$PROJECT" != "pantry" ] ||
  convex_die "DRILL_PROJECT must not be 'pantry' — the rehearsal destroys its own stack"

BASE_FILES=(
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/deploy/docker-compose.convex-postgres.yml"
  -f "$ROOT/deploy/docker-compose.drill.yml"
)
COMPOSE=(docker compose -p "$PROJECT" "${BASE_FILES[@]}")
COMPOSE_CANDIDATE=(
  docker compose -p "$PROJECT" "${BASE_FILES[@]}"
  -f "$ROOT/deploy/docker-compose.upgrade-candidate.yml"
)

CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3310"
export CONVEX_SELF_HOSTED_URL
export CONVEX_INSTANCE_SECRET="${CONVEX_INSTANCE_SECRET:-$(openssl rand -hex 32)}"
export RECIPE_SERVICE_SECRET="${RECIPE_SERVICE_SECRET:-drill-unused}"

WORK="$(mktemp -d)"
cleanup() {
  if [ "${DRILL_KEEP_STACK:-0}" = "1" ]; then
    echo "==> DRILL_KEEP_STACK=1 — leaving the $PROJECT stack up"
  else
    echo "==> tearing down the $PROJECT stack"
    "${COMPOSE_CANDIDATE[@]}" down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo
  echo "REHEARSAL FAILED: $*" >&2
  exit 1
}

refresh_admin_key() {
  unset CONVEX_SELF_HOSTED_ADMIN_KEY
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(convex_admin_key)"
  export CONVEX_SELF_HOSTED_ADMIN_KEY
}

TABLES="groceryList pantryItems"
SEED_DIR="$ROOT/scripts/fixtures/convex-drill"

PINNED="$(grep -oE 'ghcr\.io/get-convex/convex-backend@sha256:[0-9a-f]+' "$ROOT/docker-compose.yml" | head -n1)"
[ -n "$PINNED" ] || fail "could not read the pinned convex-backend digest out of docker-compose.yml"

echo "==> rehearsing upgrade"
echo "    from (pinned):  $PINNED"
echo "    to (candidate): $CONVEX_CANDIDATE_IMAGE"
if [ "$PINNED" = "$CONVEX_CANDIDATE_IMAGE" ]; then
  fail "candidate is identical to the pinned digest — nothing to rehearse"
fi

echo "==> [1/5] starting scratch stack on the PINNED image"
"${COMPOSE_CANDIDATE[@]}" down -v >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d postgres convex-backend >/dev/null
convex_wait_ready 180
refresh_admin_key
convex_cli dev --once >/dev/null

echo "==> [2/5] seeding known data on the old image"
for t in $TABLES; do
  convex_cli import --table "$t" --replace --yes --format jsonArray "$SEED_DIR/$t.json" >/dev/null
done
convex_cli export --include-file-storage --path "$WORK/before.zip" >/dev/null

echo "==> [3/5] swapping convex-backend onto the candidate image (same data)"
# up -d recreates only convex-backend, because only its image changed. Postgres
# keeps running and both volumes are reused — which is exactly the in-place
# upgrade we are testing.
"${COMPOSE_CANDIDATE[@]}" up -d convex-backend >/dev/null

# The image *reference* the container was created from — not `compose images`,
# which reports the local image ID and reads confusingly like a third digest.
running="$("${COMPOSE_CANDIDATE[@]}" ps --format '{{.Image}}' convex-backend 2>/dev/null | head -n1)"
echo "    container now created from: ${running:-unknown}"
[ "$running" = "$CONVEX_CANDIDATE_IMAGE" ] ||
  fail "expected the candidate image to be running, got '${running:-unknown}'"

echo "==> [4/5] waiting for the candidate to become healthy"
convex_wait_ready 180 || fail "candidate image never answered /version — do not bump the pin"
refresh_admin_key

echo "==> [5/5] verifying the pre-upgrade data survived"
convex_cli export --include-file-storage --path "$WORK/after.zip" >/dev/null
for t in $TABLES; do
  if ! diff <(convex_table_docs "$WORK/before.zip" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >/dev/null; then
    diff <(convex_table_docs "$WORK/before.zip" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >&2 || true
    fail "$t differs after the upgrade"
  fi
  echo "    $t: unchanged across the upgrade"
done

echo
echo "REHEARSAL PASSED — $CONVEX_CANDIDATE_IMAGE started on the old image's data"
echo "with no loss. Safe to update the pin in docker-compose.yml (and the"
echo "dashboard image alongside it). Still take a backup before the real bump."
