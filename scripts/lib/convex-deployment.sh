#!/usr/bin/env bash
# Shared helpers for talking to a self-hosted Convex deployment (BL-0008).
# Sourced by convex-backup.sh / convex-restore.sh / convex-restore-drill.sh.
#
# Callers may set, before sourcing or calling:
#   CONVEX_SELF_HOSTED_URL        target backend  (default http://127.0.0.1:3210)
#   CONVEX_SELF_HOSTED_ADMIN_KEY  admin key       (default: read from container)
#   COMPOSE                       bash array holding the `docker compose …`
#                                 invocation used to reach the backend container
# shellcheck shell=bash

CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:3210}"

convex_die() {
  echo "error: $*" >&2
  exit 1
}

convex_cli() {
  CONVEX_SELF_HOSTED_URL="$CONVEX_SELF_HOSTED_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY" \
    pnpm --silent --filter @pantry/convex exec convex "$@"
}

# convex_wait_ready [seconds] — block until the target answers /version.
#
# On timeout it dumps the backend's logs when it knows how to reach them. A bare
# "did not answer" tells you nothing; the reason is almost always sitting in the
# first few lines of the container log (a missing database, a bad POSTGRES_URL).
convex_wait_ready() {
  local deadline=${1:-120} waited=0
  while [ "$waited" -lt "$deadline" ]; do
    if curl -fsS "$CONVEX_SELF_HOSTED_URL/version" >/dev/null 2>&1; then return 0; fi
    sleep 2
    waited=$((waited + 2))
  done
  if [ "${#COMPOSE[@]}" -gt 0 ]; then
    echo "--- convex-backend logs (last 30 lines) ---" >&2
    "${COMPOSE[@]}" logs --tail 30 convex-backend >&2 2>&1 || true
    echo "--- container state ---" >&2
    "${COMPOSE[@]}" ps -a convex-backend >&2 2>&1 || true
  fi
  convex_die "convex backend at $CONVEX_SELF_HOSTED_URL did not answer /version within ${deadline}s"
}

# convex_admin_key — echo an admin key for the backend, generating one from the
# running container when the caller has not supplied CONVEX_SELF_HOSTED_ADMIN_KEY.
#
# generate_admin_key.sh reads the instance credentials the backend already
# persisted and derives a key from them; it does not restart or reconfigure the
# deployment. It may print a label around the token, hence the grep.
convex_admin_key() {
  if [ -n "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]; then
    printf '%s\n' "$CONVEX_SELF_HOSTED_ADMIN_KEY"
    return 0
  fi
  [ "${#COMPOSE[@]}" -gt 0 ] ||
    convex_die "no CONVEX_SELF_HOSTED_ADMIN_KEY and no COMPOSE invocation to read one from"

  local raw key
  raw="$("${COMPOSE[@]}" exec -T convex-backend ./generate_admin_key.sh | tr -d '\r')"
  key="$(printf '%s\n' "$raw" | grep -oE '[a-z0-9-]+\|[A-Za-z0-9|]+' | tail -n1)"
  [ -n "$key" ] || convex_die "could not parse an admin key out of generate_admin_key.sh"
  printf '%s\n' "$key"
}

# convex_table_docs <snapshot.zip> <table> — print a table's documents from a
# snapshot with the server-assigned fields stripped, sorted, one per line.
#
# _id and _creationTime are re-minted by an import, so they are the two fields a
# restore is NOT expected to reproduce. Everything else must match exactly.
convex_table_docs() {
  local zip=$1 table=$2
  unzip -p "$zip" "$table/documents.jsonl" 2>/dev/null | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
    const norm = (o) => {
      const { _id, _creationTime, ...rest } = o;
      return JSON.stringify(Object.fromEntries(Object.entries(rest).sort()));
    };
    process.stdout.write(lines.map((l) => norm(JSON.parse(l))).sort().join("\n"));
  '
}
