#!/usr/bin/env bash
# Provision a self-hosted Convex deployment (BL-0006).
#
#   scripts/provision-convex.sh --site-url http://localhost:5173 \
#                               --recipe-service-url http://recipe-service:8090
#
# Sets the deployment environment and pushes the functions. This is the ONE
# procedure both e2e and production use, so the two cannot drift.
#
#   --preserve-auth-keys   keep an auth keypair the deployment already holds.
#                          ALWAYS pass this in production: regenerating
#                          JWT_PRIVATE_KEY signs out every existing session.
#                          e2e omits it, so each run gets a fresh keypair and
#                          stays self-isolating.
#
# Target selection follows scripts/lib/convex-deployment.sh:
#   CONVEX_SELF_HOSTED_URL        default http://127.0.0.1:3210
#   CONVEX_SELF_HOSTED_ADMIN_KEY  default: read from the compose container
#
# Requires RECIPE_SERVICE_SECRET in the environment: it must match the value
# the Go service runs with, or every recipe call 401s and the app renders as
# though the user owns nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

# The admin key is the ONLY thing this script writes to stdout, and it writes it
# last. Everything else, our progress lines and the Convex CLI's own output,
# goes to stderr, so a caller can read the key with `| tail -n1` and still show
# the operator what is happening. `convex_say` exists so that intent is visible
# at each call site rather than being a bare `>&2` someone later "tidies up".
convex_say() { echo "$*" >&2; }

SITE_URL=""
RECIPE_SERVICE_URL=""
PRESERVE_AUTH_KEYS=0

# provision_write_auth_keys — mint an RS256 keypair and store it on the
# deployment. Convex Auth needs JWT_PRIVATE_KEY and JWKS to come from ONE
# keypair; two keypairs produce "Could not verify OIDC token claim" at sign-in.
#
# Newlines in the PKCS8 are stored as spaces, per @convex-dev/auth's
# convention. Node's built-in crypto is used so this does not depend on `jose`
# being hoisted somewhere the repo-root node can resolve.
provision_write_auth_keys() {
  local keys private_key jwks
  keys="$(node -e 'const c=require("crypto");const {publicKey,privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048});const pk=privateKey.export({type:"pkcs8",format:"pem"}).toString();const jwk=publicKey.export({format:"jwk"});const jwks=JSON.stringify({keys:[{use:"sig",...jwk}]});process.stdout.write(pk.trimEnd().replace(/\n/g," ")+"\n"+jwks+"\n");')"
  private_key="$(printf '%s\n' "$keys" | sed -n '1p')"
  jwks="$(printf '%s\n' "$keys" | sed -n '2p')"
  # NAME=value form: the private key value starts with "-----BEGIN", which the
  # CLI's option parser would otherwise mistake for a flag.
  convex_cli env set "JWT_PRIVATE_KEY=$private_key" >&2
  convex_cli env set "JWKS=$jwks" >&2
}

# provision_has_auth_keys — true when the deployment already holds a private key.
#
# This reads the NAME LIST rather than `env get JWT_PRIVATE_KEY`'s exit status,
# which is what the plan specified. An unset name is not documented to exit
# non-zero, and if it exits 0 the guard reads as "keys present" and skips the
# one-time generation on a FRESH production deployment, leaving sign-in broken
# with no keypair at all. That is the exact failure this flag exists to prevent,
# so the check is written to fail in the safe direction: anything other than a
# positive sighting of the name means generate. The value is a secret and is
# never read or printed.
provision_has_auth_keys() {
  convex_cli env list --names-only 2>/dev/null | grep -qx 'JWT_PRIVATE_KEY'
}

while [ $# -gt 0 ]; do
  case "$1" in
  --site-url)
    SITE_URL="$2"
    shift 2
    ;;
  --recipe-service-url)
    RECIPE_SERVICE_URL="$2"
    shift 2
    ;;
  --preserve-auth-keys)
    PRESERVE_AUTH_KEYS=1
    shift
    ;;
  -h | --help)
    sed -n '2,${/^#/!q;p;}' "$0"
    exit 0
    ;;
  *) convex_die "unknown argument: $1" ;;
  esac
done

[ -n "$SITE_URL" ] || convex_die "--site-url is required"
[ -n "$RECIPE_SERVICE_URL" ] || convex_die "--recipe-service-url is required"
[ -n "${RECIPE_SERVICE_SECRET:-}" ] || convex_die "RECIPE_SERVICE_SECRET is not set"

# The lib reads COMPOSE as an ARRAY when it needs to reach the backend
# container to generate an admin key. Default it for the local stack; in
# production the caller supplies CONVEX_SELF_HOSTED_ADMIN_KEY and it is unused.
if ! declare -p COMPOSE >/dev/null 2>&1; then
  COMPOSE=(docker compose)
fi

convex_wait_ready 120

CONVEX_SELF_HOSTED_ADMIN_KEY="$(convex_admin_key)"
export CONVEX_SELF_HOSTED_ADMIN_KEY

convex_say "==> setting Convex deployment env"
convex_cli env set SITE_URL "$SITE_URL" >&2
convex_cli env set RECIPE_SERVICE_URL "$RECIPE_SERVICE_URL" >&2
convex_cli env set RECIPE_SERVICE_SECRET "$RECIPE_SERVICE_SECRET" >&2

if [ "$PRESERVE_AUTH_KEYS" = "1" ] && provision_has_auth_keys; then
  convex_say "==> Convex Auth keys already set, preserving them"
else
  convex_say "==> generating Convex Auth keys"
  provision_write_auth_keys
fi

convex_say "==> deploying Convex functions"
convex_cli dev --once >&2

convex_say "==> provisioned $CONVEX_SELF_HOSTED_URL"
printf '%s\n' "$CONVEX_SELF_HOSTED_ADMIN_KEY"
