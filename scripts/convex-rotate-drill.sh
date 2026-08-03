#!/usr/bin/env bash
# Admin-key rotation drill for self-hosted Convex (BL-0048).
#
#   scripts/convex-rotate-drill.sh
#
# The self-hosted admin key is derived from INSTANCE_SECRET, so "rotate the
# admin key" and "change INSTANCE_SECRET" are the same operation. What that does
# to a deployment that already has data is not documented upstream, and an
# untested rotation procedure in a runbook is worse than an admitted gap — it
# gets believed during an incident. This script is the experiment behind the
# procedure in docs/self-hosted-convex-ops.md.
#
# It asserts every claim that runbook makes, so a future backend image that
# changes this behaviour fails the drill instead of silently invalidating the
# documentation:
#
#   * changing INSTANCE_SECRET and restarting brings the backend back up
#   * documents survive the rotation byte-for-byte
#   * deployment environment variables survive it too
#   * old admin keys stop being accepted (HTTP 401)
#   * the newly derived key is accepted (HTTP 200)
#   * generate_admin_key.sh emits a DIFFERENT key each run and every key
#     derived from the current secret is valid — so issuing a new key revokes
#     nothing, and the secret is the only revocation lever
#   * rotation is REVERSIBLE by a stale .env: restarting on the old secret makes
#     the "revoked" key valid again. This is the footgun the runbook leads with,
#     so it is asserted rather than described.
#
# Safety. The drill only ever operates on its own compose project
# (`pantry-keyrot` by default) with its own named volumes and shifted host ports
# — see deploy/docker-compose.keyrot.yml. It refuses to run under the `pantry`
# project, and the `down -v` it issues is scoped to the drill project, so it
# cannot reach the developer stack's ./.data bind mounts. It is safe to run
# while the normal stack is up.
#
# Env knobs:
#   ROTATE_PROJECT=pantry-keyrot  compose project name (must not be `pantry`)
#   ROTATE_KEEP_STACK=1           leave the scratch stack up afterwards
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

PROJECT="${ROTATE_PROJECT:-pantry-keyrot}"
[ "$PROJECT" != "pantry" ] ||
  convex_die "ROTATE_PROJECT must not be 'pantry' — the drill destroys its own stack"

COMPOSE=(
  docker compose -p "$PROJECT"
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/deploy/docker-compose.convex-postgres.yml"
  -f "$ROOT/deploy/docker-compose.keyrot.yml"
)

# The scratch backend lives on the shifted ports from the keyrot override, so a
# mistargeted command fails to connect rather than reaching the real stack.
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3410"
export CONVEX_SELF_HOSTED_URL

# A stray `CONVEX_DEPLOYMENT` in packages/convex/.env.local makes every CLI call
# fail with "CONVEX_DEPLOYMENT must not be set when CONVEX_SELF_HOSTED_URL and
# CONVEX_SELF_HOSTED_ADMIN_KEY are set". `convex dev` writes exactly that line
# when it falls back to an anonymous deployment, so it is easy to acquire by
# accident and confusing to diagnose from the middle of a drill.
if [ -f "$ROOT/packages/convex/.env.local" ] &&
  grep -q '^CONVEX_DEPLOYMENT=' "$ROOT/packages/convex/.env.local"; then
  convex_die "packages/convex/.env.local sets CONVEX_DEPLOYMENT — remove that line (it is an anonymous-deployment leftover) or the Convex CLI will refuse every self-hosted command"
fi

# Two ephemeral, drill-only instance secrets: the one we start on and the one we
# rotate to. The base compose file also requires RECIPE_SERVICE_SECRET to be set
# even though the drill never starts recipe-service.
SECRET_OLD="$(openssl rand -hex 32)"
SECRET_NEW="$(openssl rand -hex 32)"
export RECIPE_SERVICE_SECRET="${RECIPE_SERVICE_SECRET:-keyrot-unused}"
export CONVEX_INSTANCE_SECRET="$SECRET_OLD"

WORK="$(mktemp -d)"

# `convex dev --once` rewrites CONVEX_URL / CONVEX_SITE_URL in
# packages/convex/.env.local to whatever deployment it just talked to — which,
# during the drill, is the scratch backend on 3410. Left behind, that silently
# re-points a developer's CLI at a deployment the drill has since deleted. Stash
# the file and put it back.
ENV_LOCAL="$ROOT/packages/convex/.env.local"
ENV_LOCAL_SAVED=""
if [ -f "$ENV_LOCAL" ]; then
  ENV_LOCAL_SAVED="$WORK/env.local.saved"
  cp "$ENV_LOCAL" "$ENV_LOCAL_SAVED"
fi

restore_env_local() {
  if [ -n "$ENV_LOCAL_SAVED" ]; then
    cp "$ENV_LOCAL_SAVED" "$ENV_LOCAL"
  else
    # It did not exist before the drill; do not invent one.
    rm -f "$ENV_LOCAL"
  fi
}

cleanup() {
  restore_env_local
  if [ "${ROTATE_KEEP_STACK:-0}" = "1" ]; then
    echo "==> ROTATE_KEEP_STACK=1 — leaving the $PROJECT stack up"
  else
    echo "==> tearing down the $PROJECT stack"
    # `docker compose down` interpolates the whole file, so the `:?` guards on
    # CONVEX_INSTANCE_SECRET / RECIPE_SERVICE_SECRET apply to teardown as well
    # as to `up`. They are still exported here, so this is safe.
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo
  echo "ROTATION DRILL FAILED: $*" >&2
  exit 1
}

# --- helpers ---------------------------------------------------------------

# probe_key <admin key> — echo the HTTP status the backend gives that key.
#
# Deliberately a raw HTTP call against a _system endpoint rather than a CLI
# invocation: it is independent of this repo's function names, and it reports a
# rejection as a status code instead of the WebSocket reconnect loop the CLI
# enters when its key is refused.
probe_key() {
  curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$CONVEX_SELF_HOSTED_URL/api/query" \
    -H "Authorization: Convex $1" \
    -H 'Content-Type: application/json' \
    -d '{"path":"_system/cli/queryEnvironmentVariables:get","args":{},"format":"json"}'
}

# restart_on <instance secret> — recreate the backend with a different secret.
# This is the rotation itself; everything else in the drill is observation.
restart_on() {
  CONVEX_INSTANCE_SECRET="$1" "${COMPOSE[@]}" up -d --force-recreate convex-backend >/dev/null
  convex_wait_ready 180
}

fresh_key() {
  local key
  key="$(CONVEX_SELF_HOSTED_ADMIN_KEY= convex_admin_key)"
  printf '%s\n' "$key"
}

row_count() {
  local docs
  docs="$(convex_table_docs "$1" "$2")"
  [ -z "$docs" ] && echo 0 || printf '%s\n' "$docs" | wc -l | tr -d ' '
}

TABLES="groceryList pantryItems"
SEED_DIR="$ROOT/scripts/fixtures/convex-drill"
CANARY_NAME="ROTATION_CANARY"
CANARY_VALUE="set-before-rotation"

# --- 1. a deployment with data in it ---------------------------------------

echo "==> [1/8] starting scratch stack ($PROJECT, Postgres-backed, port 3410)"
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d postgres convex-backend >/dev/null
convex_wait_ready 180

# Rotation has to be drilled against the configuration we intend to run, not
# against a silent SQLite fallback.
if ! "${COMPOSE[@]}" exec -T postgres psql -U pantry -d convex_self_hosted -c '\dt' 2>/dev/null | grep -q documents; then
  fail "convex_self_hosted has no 'documents' table — the backend fell back to SQLite"
fi
echo "    backing store confirmed: Postgres (convex_self_hosted.documents present)"

echo "==> [2/8] deploying functions, seeding data, setting a canary env var"
KEY_OLD="$(fresh_key)"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$KEY_OLD"
convex_cli dev --once >/dev/null
for t in $TABLES; do
  # The path must be absolute: the CLI runs with packages/convex as its cwd.
  convex_cli import --table "$t" --replace --yes --format jsonArray "$SEED_DIR/$t.json" >/dev/null
done
convex_cli env set "$CANARY_NAME" "$CANARY_VALUE" >/dev/null

convex_cli export --include-file-storage --path "$WORK/before.zip" >/dev/null
for t in $TABLES; do
  n="$(row_count "$WORK/before.zip" "$t")"
  [ "$n" -gt 0 ] || fail "seeded 0 rows into $t — the drill would prove nothing"
  echo "    $t: $n rows"
done

# --- 3. issuing a new key is NOT revocation --------------------------------
#
# The instinct on a leaked key is "generate a new one". This step is here to
# show that does nothing: the old key keeps working.

echo "==> [3/8] checking whether issuing a second key revokes the first"
KEY_SECOND="$(fresh_key)"
[ "$KEY_SECOND" != "$KEY_OLD" ] ||
  fail "generate_admin_key.sh returned an identical key twice — the no-revocation claim in the runbook needs re-checking"
[ "$(probe_key "$KEY_SECOND")" = "200" ] || fail "a freshly generated key was rejected"
[ "$(probe_key "$KEY_OLD")" = "200" ] ||
  fail "the first key stopped working after generating a second — the runbook says it does not"
echo "    two different keys from the same secret, BOTH accepted (issuing a key revokes nothing)"

# --- 4. the rotation -------------------------------------------------------

echo "==> [4/8] ROTATING: restarting the backend on a new INSTANCE_SECRET"
START="$(date +%s)"
restart_on "$SECRET_NEW"
echo "    backend answered /version $(($(date +%s) - START))s after the restart was issued"

PERSISTED="$("${COMPOSE[@]}" exec -T convex-backend sh -c 'cat /convex/data/credentials/instance_secret' | tr -d '\r\n')"
[ "$PERSISTED" = "$SECRET_NEW" ] ||
  fail "the persisted instance_secret is not the new one — read_credentials.sh no longer prefers the env var over the file, and the whole procedure changes"
echo "    /convex/data/credentials/instance_secret now holds the new secret"

echo "==> [5/8] checking the old keys are dead and a new one works"
KEY_NEW="$(fresh_key)"
for k in "$KEY_OLD" "$KEY_SECOND"; do
  code="$(probe_key "$k")"
  [ "$code" = "401" ] || fail "a pre-rotation admin key still returns HTTP $code — rotation did not revoke it"
done
[ "$(probe_key "$KEY_NEW")" = "200" ] || fail "the post-rotation admin key was rejected"
echo "    both pre-rotation keys -> HTTP 401, newly derived key -> HTTP 200"

echo "==> [6/8] checking the data and deployment env survived"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$KEY_NEW"
convex_cli export --include-file-storage --path "$WORK/after.zip" >/dev/null
for t in $TABLES; do
  if ! diff <(convex_table_docs "$WORK/before.zip" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >/dev/null; then
    echo "--- mismatch in $t ---" >&2
    diff <(convex_table_docs "$WORK/before.zip" "$t") <(convex_table_docs "$WORK/after.zip" "$t") >&2 || true
    fail "$t changed across the rotation — rotation is not data-safe on this image"
  fi
  echo "    $t: $(row_count "$WORK/after.zip" "$t") rows, contents identical to pre-rotation"
done

if ! convex_cli env get "$CANARY_NAME" 2>/dev/null | grep -qx "$CANARY_VALUE"; then
  fail "the canary env var did not survive the rotation — deployment env is not independent of the instance secret"
fi
echo "    deployment env survived ($CANARY_NAME still reads back unchanged)"

# --- 7. the footgun --------------------------------------------------------
#
# Rotation is not a one-way door. The secret is whatever the environment says it
# is on the next boot, so a .env that was never updated silently un-rotates the
# deployment and makes the leaked key live again. Asserted, not described,
# because it is the single most dangerous property of this procedure.

echo "==> [7/8] checking rotation is reversible by a stale .env (the footgun)"
restart_on "$SECRET_OLD"
[ "$(probe_key "$KEY_OLD")" = "200" ] ||
  fail "restarting on the old secret did NOT restore the old key — the runbook's warning is wrong and should be corrected"
[ "$(probe_key "$KEY_NEW")" = "401" ] ||
  fail "the post-rotation key still works after reverting the secret"
echo "    restarting on the OLD secret revived the revoked key (HTTP 200) — as documented"

echo "==> [8/8] returning the scratch deployment to the rotated secret"
restart_on "$SECRET_NEW"
[ "$(probe_key "$KEY_OLD")" = "401" ] || fail "re-rotation did not take"
echo "    re-rotated; old key rejected again"

echo
echo "ROTATION DRILL PASSED — rotation revokes every prior key, preserves data"
echo "and deployment env, and is undone by a stale INSTANCE_SECRET."
