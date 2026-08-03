#!/usr/bin/env bash
# Restore a Convex snapshot into a self-hosted deployment (BL-0008).
#
#   scripts/convex-restore.sh .backups/20260803T161500Z/snapshot.zip --yes
#
# THIS IS DESTRUCTIVE. It runs `convex import --replace-all`, which deletes
# every document in the target deployment that the snapshot does not contain.
# It refuses to run without --yes for exactly that reason.
#
# Restoring data is only half of a recovery. The functions and schema come from
# git, not from the snapshot, and the deployment env has to be re-set. Full
# order of operations, and the reasoning, in docs/self-hosted-convex-ops.md:
#
#   1. bring up an empty backend      (docker compose up -d convex-backend)
#   2. redeploy the functions         (pnpm --filter @pantry/convex deploy)
#   3. re-set deployment env          (convex env set …)
#   4. restore the data               (this script)
#
# Step 2 must come first: an import validates against the deployed schema, so
# restoring into a schema-less backend silently gives you untyped tables.
#
# Target selection: CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY if
# exported, else the local compose stack on 127.0.0.1:3210.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

SNAPSHOT=""
CONFIRMED=0

while [ $# -gt 0 ]; do
  case "$1" in
  -y | --yes)
    CONFIRMED=1
    shift
    ;;
  -h | --help)
    sed -n '2,25p' "$0"
    exit 0
    ;;
  -*) convex_die "unknown argument: $1" ;;
  *)
    SNAPSHOT="$1"
    shift
    ;;
  esac
done

[ -n "$SNAPSHOT" ] || convex_die "usage: scripts/convex-restore.sh <snapshot.zip> --yes"
[ -f "$SNAPSHOT" ] || convex_die "no such snapshot: $SNAPSHOT"

COMPOSE=(docker compose)
CONVEX_SELF_HOSTED_ADMIN_KEY="$(convex_admin_key)"
export CONVEX_SELF_HOSTED_ADMIN_KEY

echo "==> restoring $SNAPSHOT"
echo "==> into      $CONVEX_SELF_HOSTED_URL"
if [ "$CONFIRMED" != "1" ]; then
  convex_die "refusing to --replace-all without --yes (this deletes existing data)"
fi

convex_wait_ready 60
convex_cli import --replace-all --yes "$SNAPSHOT"
echo "==> restore complete"
