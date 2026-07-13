#!/usr/bin/env bash
# Run the Playwright end-to-end test (BL-0014) against a REAL, full stack.
#
#   pnpm test:e2e
#
# It drives the core loop in a browser — sign up → create a recipe → plan a day
# → generate the aggregated grocery list → check an item off → reload persists —
# against Postgres + recipe-service + self-hosted Convex + the Vite dev server.
# This catches cross-service regressions (Convex Auth, Convex reactivity, the
# Convex→recipe-service HTTP aggregation, the controlled checkbox) that the unit
# suites and typecheck cannot.
#
# What it does:
#   1. Ensures ephemeral secrets in .env (gitignored).
#   2. Brings up the compose stack (postgres, recipe-service, convex-backend).
#   3. Generates a Convex admin key and points the Convex CLI at the backend.
#   4. Sets the deployment env (auth keys, SITE_URL, recipe-service wiring).
#   5. Pushes the Convex functions (`convex dev --once`).
#   6. Runs Playwright, which starts the Vite dev server and drives the browser.
#
# Requirements:
#   - Docker + Docker Compose, Go (to build the recipe-service image), pnpm.
#   - A Playwright browser with OS deps, installed once with:
#       pnpm --filter @pantry/web exec playwright install --with-deps chromium
#     (the sandbox/CI needs libnspr4, libnss3, libgbm1, libasound2).
#
# Env knobs:
#   E2E_KEEP_STACK=1   leave the compose stack running afterwards (debugging).
#
# Extra args after `pnpm test:e2e` are forwarded to `playwright test`
# (e.g. `pnpm test:e2e --headed --debug`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONVEX_URL="http://127.0.0.1:3210"
SITE_URL="http://localhost:5173"
# recipe-service is reached from INSIDE the convex-backend container, so use the
# compose service name + in-container port, not the host mapping.
RECIPE_SERVICE_INTERNAL_URL="http://recipe-service:8090"

convex_cli() { pnpm --filter @pantry/convex exec convex "$@"; }

# --- 1. ephemeral secrets (root .env is gitignored) ------------------------
if [ ! -f .env ]; then
  {
    echo "CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)"
    echo "RECIPE_SERVICE_SECRET=$(openssl rand -hex 32)"
  } >.env
  echo "==> wrote .env (ephemeral secrets)"
fi
# shellcheck disable=SC1091
set -a && . ./.env && set +a

cleanup() {
  if [ "${E2E_KEEP_STACK:-0}" = "1" ]; then
    echo "==> E2E_KEEP_STACK=1 — leaving the stack up"
  else
    echo "==> tearing down compose stack"
    docker compose down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- 2. bring up the stack -------------------------------------------------
echo "==> starting stack (postgres, recipe-service, convex-backend)"
docker compose up -d --build postgres recipe-service convex-backend

echo "==> waiting for convex-backend to answer /version"
for _ in $(seq 1 60); do
  if curl -fsS "$CONVEX_URL/version" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$CONVEX_URL/version" >/dev/null || {
  echo "convex-backend did not become healthy" >&2
  exit 1
}

# --- 3. admin key + CLI target ---------------------------------------------
echo "==> generating Convex admin key"
# The self-hosted image ships generate_admin_key.sh in the working dir. If the
# path ever changes, inspect it with: docker compose exec convex-backend ls
ADMIN_KEY="$(docker compose exec -T convex-backend ./generate_admin_key.sh | tr -d '\r')"
# Keep only the token, in case the script prints a surrounding label/blank line.
ADMIN_KEY="$(printf '%s\n' "$ADMIN_KEY" | grep -oE 'convex-self-hosted\|[A-Za-z0-9|]+' | tail -n1)"
[ -n "$ADMIN_KEY" ] || {
  echo "could not parse the admin key from generate_admin_key.sh" >&2
  exit 1
}
export CONVEX_SELF_HOSTED_URL="$CONVEX_URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"

# --- 4. deployment env -----------------------------------------------------
echo "==> setting Convex deployment env"
convex_cli env set SITE_URL "$SITE_URL"
convex_cli env set RECIPE_SERVICE_URL "$RECIPE_SERVICE_INTERNAL_URL"
convex_cli env set RECIPE_SERVICE_SECRET "$RECIPE_SERVICE_SECRET"

# Convex Auth needs an RS256 keypair (JWT_PRIVATE_KEY + JWKS). Newlines in the
# PKCS8 are stored as spaces, per @convex-dev/auth's convention.
echo "==> generating Convex Auth keys"
KEYS="$(node -e "const {generateKeyPair,exportPKCS8,exportJWK}=require('jose');(async()=>{const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true});const pk=await exportPKCS8(privateKey);const jwk=await exportJWK(publicKey);const jwks=JSON.stringify({keys:[{use:'sig',...jwk}]});process.stdout.write(pk.trimEnd().replace(/\n/g,' ')+'\n'+jwks+'\n');})()")"
JWT_PRIVATE_KEY="$(printf '%s\n' "$KEYS" | sed -n '1p')"
JWKS="$(printf '%s\n' "$KEYS" | sed -n '2p')"
convex_cli env set JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY"
convex_cli env set JWKS "$JWKS"

# --- 5. push functions -----------------------------------------------------
echo "==> deploying Convex functions"
convex_cli dev --once

# --- 6. run the browser test ----------------------------------------------
echo "==> running Playwright (starts the Vite dev server)"
pnpm --filter @pantry/web exec playwright test "$@"

echo "==> e2e passed"
