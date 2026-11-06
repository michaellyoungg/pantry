#!/usr/bin/env bash
# Provision a self-hosted Convex deployment (BL-0006).
#
#   scripts/provision-convex.sh --site-url http://localhost:5173 \
#                               --recipe-service-url http://recipe-service:8090
#
# Sets the deployment environment and pushes the functions. This is the ONE
# procedure both e2e and production use, so the two cannot drift.
#
#   --recipe-service-url   where Convex should reach recipe-service. Defaults to
#                          $RECIPE_SERVICE_URL, which on Railway is a variable
#                          on convex-backend holding
#                          http://${{recipe-service.RAILWAY_PRIVATE_DOMAIN}}:8090
#                          so Railway owns that hostname rather than this script.
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

# Captured BEFORE sourcing the lib, which defaults CONVEX_SELF_HOSTED_URL to
# the local stack. After that point a defaulted value is indistinguishable from
# a deliberate one, and the difference decides whether a production run talks to
# production or to the operator's laptop.
PROVISION_URL_EXPLICIT="${CONVEX_SELF_HOSTED_URL:+yes}"

# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

# The admin key is the ONLY thing this script writes to stdout, and it writes it
# last. Everything else, our progress lines and the Convex CLI's own output,
# goes to stderr, so a caller can read the key with `| tail -n1` and still show
# the operator what is happening. `convex_say` exists so that intent is visible
# at each call site rather than being a bare `>&2` someone later "tidies up".
convex_say() { echo "$*" >&2; }

SITE_URL=""
# Seeded from the environment so a caller can let Railway supply it. The one
# cross-service link Railway could not see was convex-backend -> recipe-service,
# because this hostname lived only inside the Convex deployment and was written
# here as a literal. Taking it from a variable means Railway holds it as a real
# `${{recipe-service.RAILWAY_PRIVATE_DOMAIN}}` reference, which both draws the
# dependency and survives the service being renamed or moved.
RECIPE_SERVICE_URL="${RECIPE_SERVICE_URL:-}"
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
# because `env get` on an unset name exits 0 and prints nothing, so its status
# answers nothing at all.
#
# A FAILED listing is fatal rather than an answer. The two wrong answers are not
# symmetric. Reading "absent" when keys exist regenerates the keypair on a live
# deployment, which voids every issued session and discards the old private key:
# unrecoverable, and the single thing --preserve-auth-keys exists to prevent.
# Reading "present" when they do not exist leaves sign-in broken on a fresh
# deployment, which the smoke test catches immediately and a re-run without the
# flag fixes, with no data touched. So when the listing cannot be trusted, this
# refuses to decide instead of guessing toward the irreversible outcome.
#
# The value is a secret and is never read or printed.
provision_has_auth_keys() {
  local names
  names="$(convex_cli env list --names-only)" ||
    convex_die "could not list the deployment env vars, so refusing to decide about the auth keypair; re-run once the deployment answers"
  printf '%s\n' "$names" | grep -qx 'JWT_PRIVATE_KEY'
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
[ -n "$RECIPE_SERVICE_URL" ] ||
  convex_die "no recipe-service URL: pass --recipe-service-url, or set RECIPE_SERVICE_URL (on Railway it is a variable on convex-backend)"
[ -n "${RECIPE_SERVICE_SECRET:-}" ] || convex_die "RECIPE_SERVICE_SECRET is not set"

# --preserve-auth-keys IS the production mode, so production has to name its
# target. Both of these otherwise resolve toward the LOCAL stack:
# CONVEX_SELF_HOSTED_URL defaults to 127.0.0.1:3210, and the admin key is
# derived by running generate_admin_key.sh inside the local container. A
# production run missing either one sets SITE_URL on the operator's laptop to
# the production domain, pushes functions there, prints "provisioned", and exits
# 0 while production is untouched. That is discovered several steps later, at the
# smoke test, and it breaks local dev on the way.
if [ "$PRESERVE_AUTH_KEYS" = "1" ]; then
  [ -n "$PROVISION_URL_EXPLICIT" ] ||
    convex_die "--preserve-auth-keys is the production mode: set CONVEX_SELF_HOSTED_URL explicitly, or this would target $CONVEX_SELF_HOSTED_URL"
  [ -n "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ] ||
    convex_die "--preserve-auth-keys is the production mode: set CONVEX_SELF_HOSTED_ADMIN_KEY explicitly, or this would derive one from the local compose container"
fi

# The lib reaches for the backend CONTAINER through COMPOSE, to derive an admin
# key and to dump logs when a wait times out. Default it for the local stack
# only: production has no container, and defaulting it there makes a timeout
# print 30 lines of a healthy, unrelated local backend immediately above "the
# backend did not answer", which is worse than no diagnosis.
#
# Tested for an ARRAY rather than mere existence, because a stray scalar COMPOSE
# in the environment expands to one word and surfaces as "could not parse an
# admin key" instead of naming the real problem.
if [ "$PRESERVE_AUTH_KEYS" != "1" ]; then
  case "$(declare -p COMPOSE 2>/dev/null || true)" in
  "declare -a"*) ;;
  *) COMPOSE=(docker compose) ;;
  esac
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
