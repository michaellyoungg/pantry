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

# e2e_ensure_secrets — give .env a real value for every ephemeral secret the
# compose stack interpolates.
#
# Ensured per VARIABLE and per VALUE, which are two separate traps.
#
# Gating on the FILE existing left a .env that exists but is missing a name
# unrepaired forever. Matching `^NAME=` alone left the likelier case unrepaired
# too: .env.example ships CONVEX_INSTANCE_SECRET= and RECIPE_SERVICE_SECRET=
# with EMPTY values and tells you to copy it and fill them in, and compose's
# ${VAR:?} fails on null exactly as it does on unset. So the match requires a
# value. Either way the symptom lands four steps later as "required variable
# RECIPE_SERVICE_SECRET is missing a value", which names the variable but not
# the reason. CI never sees any of it, because CI has no .env at all.
#
# Appending, never rewriting the file, is the other half: CONVEX_INSTANCE_SECRET
# is what the backend derived ./.data/convex/credentials from, so handing it a
# fresh value locks it out of its own data.
e2e_ensure_secrets() {
  local name
  touch .env
  for name in CONVEX_INSTANCE_SECRET RECIPE_SERVICE_SECRET; do
    if grep -qE "^${name}=.+" .env; then continue; fi
    # Drop a valueless assignment before appending, so the file does not carry
    # the same name twice and leave the winner to source order.
    if grep -q "^${name}=" .env; then
      grep -v "^${name}=" .env >.env.tmp && mv .env.tmp .env
    fi
    echo "${name}=$(openssl rand -hex 32)" >>.env
    echo "==> set $name in .env"
  done
}

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
  e2e_ensure_secrets
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

  # --- 3-5. provision the deployment (shared with production, BL-0006) -----
  # scripts/provision-convex.sh is the ONE provisioning procedure: it waits for
  # the backend, mints an admin key, sets the deployment env, writes the auth
  # keypair, and pushes the functions. Production runs the same script, so the
  # two cannot drift.
  #
  # e2e deliberately does NOT pass --preserve-auth-keys. A fresh keypair per run
  # is what keeps the suite self-isolating; production must never rotate it,
  # because that signs out every existing session.
  #
  # It runs in a subshell, so its exports do not reach us. The admin key is its
  # last line of stdout and every progress line goes to stderr, which is why
  # `tail -n1` is enough to separate them.
  export CONVEX_SELF_HOSTED_URL="$E2E_CONVEX_URL"
  # Cleared deliberately. convex_admin_key honours an inherited key, and the
  # code this replaced always derived one from the container. The runbook tells
  # the operator to export a PRODUCTION key for step 6, so without this a
  # `pnpm test:e2e` in that same shell carries it into the local run and gets it
  # rejected, nowhere near the cause. The siblings do the same:
  # convex-restore-drill.sh and convex-upgrade-rehearsal.sh both unset it.
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(
    CONVEX_SELF_HOSTED_ADMIN_KEY= bash scripts/provision-convex.sh \
      --site-url "$site_url" \
      --recipe-service-url "$E2E_RECIPE_SERVICE_INTERNAL_URL" | tail -n1
  )"
  [ -n "$CONVEX_SELF_HOSTED_ADMIN_KEY" ] || e2e_die "provision-convex.sh returned no admin key"
  export CONVEX_SELF_HOSTED_ADMIN_KEY
}
