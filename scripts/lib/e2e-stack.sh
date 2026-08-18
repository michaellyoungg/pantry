#!/usr/bin/env bash
# The full stack an end-to-end run needs, brought up once (BL-0072).
#
# Sourced by scripts/e2e.sh (browser) and scripts/mobile-e2e.sh (device). The
# two suites drive different clients against the *same* backend, and everything
# below the client is identical: Postgres, recipe-service, self-hosted Convex,
# the seeded catalog, an admin key, the deployment env, and the pushed
# functions. This was inlined in e2e.sh until the mobile runner needed it too,
# and a second copy of it would have been a second thing to keep in step with
# the compose file.
#
# Callers set, before calling:
#   E2E_KEEP_STACK=1   leave the stack running afterwards (debugging)
# shellcheck shell=bash

E2E_CONVEX_URL="http://127.0.0.1:3210"
# recipe-service is reached from INSIDE the convex-backend container, so use the
# compose service name + in-container port, not the host mapping.
E2E_RECIPE_SERVICE_INTERNAL_URL="http://recipe-service:8090"

e2e_die() {
  echo "error: $*" >&2
  exit 1
}

e2e_convex_cli() { pnpm --filter @pantry/convex exec convex "$@"; }

# Register with `trap e2e_stack_teardown EXIT`.
e2e_stack_teardown() {
  if [ "${E2E_KEEP_STACK:-0}" = "1" ]; then
    echo "==> E2E_KEEP_STACK=1 — leaving the stack up"
  else
    echo "==> tearing down compose stack"
    docker compose down -v >/dev/null 2>&1 || true
  fi
}

# e2e_stack_up <site_url>
#
# Exports CONVEX_SELF_HOSTED_URL / CONVEX_SELF_HOSTED_ADMIN_KEY on the way
# through, so a caller can keep talking to the deployment afterwards.
e2e_stack_up() {
  local site_url=$1

  # --- 1. ephemeral secrets (root .env is gitignored) ----------------------
  if [ ! -f .env ]; then
    {
      echo "CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)"
      echo "RECIPE_SERVICE_SECRET=$(openssl rand -hex 32)"
    } >.env
    echo "==> wrote .env (ephemeral secrets)"
  fi
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a

  # --- 2. bring up the stack ----------------------------------------------
  echo "==> starting stack (postgres, recipe-service, convex-backend)"
  docker compose up -d --build postgres recipe-service convex-backend

  # The shared browse-and-pick catalog is system data owned by the `catalog`
  # sentinel user, and it exists in every other environment because someone ran
  # this job. Without it here, GET /catalog, the /recipes/catalog route,
  # add-catalog-recipe-to-basket and catalog-sourced recommendations are all
  # empty for the whole suite, so an integration break in any of them reaches
  # main green (BL-0051).
  #
  # Ordered before the convex-backend wait deliberately: the backend is still
  # booting, so this costs no wall clock in the common case. The job connects
  # straight to Postgres and applies schema.sql itself, so it does not depend on
  # recipe-service having finished starting. Recipes upsert by stable id, so
  # re-running against a warm ./.data/postgres is inert.
  echo "==> seeding the shared recipe catalog"
  docker compose run --rm --build -T seed

  echo "==> waiting for convex-backend to answer /version"
  for _ in $(seq 1 60); do
    if curl -fsS "$E2E_CONVEX_URL/version" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -fsS "$E2E_CONVEX_URL/version" >/dev/null || e2e_die "convex-backend did not become healthy"

  # --- 3. admin key + CLI target ------------------------------------------
  echo "==> generating Convex admin key"
  # The self-hosted image ships generate_admin_key.sh in the working dir. If the
  # path ever changes, inspect it with: docker compose exec convex-backend ls
  local admin_key
  admin_key="$(docker compose exec -T convex-backend ./generate_admin_key.sh | tr -d '\r')"
  # Keep only the token, in case the script prints a surrounding label/blank line.
  admin_key="$(printf '%s\n' "$admin_key" | grep -oE 'convex-self-hosted\|[A-Za-z0-9|]+' | tail -n1)"
  [ -n "$admin_key" ] || e2e_die "could not parse the admin key from generate_admin_key.sh"
  export CONVEX_SELF_HOSTED_URL="$E2E_CONVEX_URL"
  export CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key"

  # --- 4. deployment env ---------------------------------------------------
  echo "==> setting Convex deployment env"
  e2e_convex_cli env set SITE_URL "$site_url"
  e2e_convex_cli env set RECIPE_SERVICE_URL "$E2E_RECIPE_SERVICE_INTERNAL_URL"
  e2e_convex_cli env set RECIPE_SERVICE_SECRET "$RECIPE_SERVICE_SECRET"

  # Convex Auth needs an RS256 keypair (JWT_PRIVATE_KEY + JWKS). Newlines in the
  # PKCS8 are stored as spaces, per @convex-dev/auth's convention. Use Node's
  # built-in crypto so this has no dependency on `jose` being hoisted to a place
  # the repo-root `node` can resolve.
  echo "==> generating Convex Auth keys"
  local keys jwt_private_key jwks
  keys="$(node -e 'const c=require("crypto");const {publicKey,privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048});const pk=privateKey.export({type:"pkcs8",format:"pem"}).toString();const jwk=publicKey.export({format:"jwk"});const jwks=JSON.stringify({keys:[{use:"sig",...jwk}]});process.stdout.write(pk.trimEnd().replace(/\n/g," ")+"\n"+jwks+"\n");')"
  jwt_private_key="$(printf '%s\n' "$keys" | sed -n '1p')"
  jwks="$(printf '%s\n' "$keys" | sed -n '2p')"
  # Use the NAME=value form: the private key value starts with "-----BEGIN",
  # which the CLI's option parser would otherwise mistake for a flag. Splitting
  # on the first "=" keeps the leading dashes as part of the value.
  e2e_convex_cli env set "JWT_PRIVATE_KEY=$jwt_private_key"
  e2e_convex_cli env set "JWKS=$jwks"

  # --- 5. push functions ---------------------------------------------------
  echo "==> deploying Convex functions"
  e2e_convex_cli dev --once
}
