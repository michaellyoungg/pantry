#!/usr/bin/env bash
# Back up a self-hosted Convex deployment (BL-0008).
#
#   scripts/convex-backup.sh                          # local stack -> ./.backups
#   scripts/convex-backup.sh --out /srv/backups --keep 14
#   scripts/convex-backup.sh --include-env            # also capture deployment env
#
# Writes <out>/<UTC-timestamp>/snapshot.zip: a Convex snapshot export including
# file storage. This is deliberately the *logical* backup rather than a
# pg_dump. It is store-agnostic (identical whether the deployment is on SQLite
# or Postgres), it captures uploaded files — which live on the container's data
# volume and would be missed by any database dump — and it is the only format
# `convex import` can restore.
#
# Run a pg_dump too if you want a physical Postgres backup for point-in-time
# recovery; it complements this, it does not replace it.
#
# A snapshot does NOT contain, so a real recovery also needs:
#   * The functions and schema — those live in git and are redeployed with
#     `convex dev --once`. See docs/self-hosted-convex-ops.md.
#   * Deployment environment variables (JWT_PRIVATE_KEY, JWKS,
#     RECIPE_SERVICE_SECRET, ...). --include-env captures them; read the
#     warning it prints before you use it.
#
# Target selection: CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY if
# exported, else the local compose stack on 127.0.0.1:3210 with an admin key
# read from the running convex-backend container.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

OUT_DIR="${CONVEX_BACKUP_DIR:-$ROOT/.backups}"
KEEP=10
INCLUDE_ENV=0

while [ $# -gt 0 ]; do
  case "$1" in
  --out)
    OUT_DIR="$2"
    shift 2
    ;;
  --keep)
    KEEP="$2"
    shift 2
    ;;
  --include-env)
    INCLUDE_ENV=1
    shift
    ;;
  -h | --help)
    sed -n '2,32p' "$0"
    exit 0
    ;;
  *) convex_die "unknown argument: $1" ;;
  esac
done

COMPOSE=(docker compose)
CONVEX_SELF_HOSTED_ADMIN_KEY="$(convex_admin_key)"
export CONVEX_SELF_HOSTED_ADMIN_KEY

echo "==> target: $CONVEX_SELF_HOSTED_URL"
convex_wait_ready 60

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/$STAMP"
mkdir -p "$DEST"

echo "==> exporting snapshot (including file storage)"
convex_cli export --include-file-storage --path "$DEST/snapshot.zip"

if [ "$INCLUDE_ENV" = "1" ]; then
  echo "==> capturing deployment environment variables"
  echo "    WARNING: this writes deployment SECRETS (JWT_PRIVATE_KEY, service"
  echo "    secrets) to $DEST/env.txt in plaintext. Store this backup somewhere"
  echo "    you would be willing to store the secrets themselves."
  umask 077
  convex_cli env list >"$DEST/env.txt"
  chmod 600 "$DEST/env.txt"
fi

# Record what produced the snapshot, so a restore knows which commit's
# functions to redeploy alongside it.
{
  echo "created_utc=$STAMP"
  echo "source_url=$CONVEX_SELF_HOSTED_URL"
  echo "git_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "includes_env=$INCLUDE_ENV"
} >"$DEST/manifest.txt"

echo "==> wrote $DEST/snapshot.zip ($(du -h "$DEST/snapshot.zip" | cut -f1))"

# Retention: keep the newest $KEEP timestamped directories. The timestamps sort
# lexicographically, so listing order is chronological order.
# (No mapfile/readarray here — macOS still ships bash 3.2.)
if [ "$KEEP" -gt 0 ]; then
  all=()
  while IFS= read -r line; do
    [ -n "$line" ] && all+=("$line")
  done < <(cd "$OUT_DIR" && ls -1d 20[0-9]* 2>/dev/null | sort)
  prune=$((${#all[@]} - KEEP))
  i=0
  while [ "$i" -lt "$prune" ]; do
    old="${all[$i]}"
    echo "==> pruning old backup $old"
    rm -rf "${OUT_DIR:?}/${old:?}"
    i=$((i + 1))
  done
fi
