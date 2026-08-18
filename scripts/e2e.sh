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
#   1. Brings the whole backend up — see scripts/lib/e2e-stack.sh, which
#      scripts/mobile-e2e.sh shares: compose stack, seeded catalog, admin key,
#      deployment env, pushed Convex functions.
#   2. Builds the workspace packages the Vite dev server resolves.
#   3. Runs Playwright, which starts the Vite dev server and drives the browser.
#
# Requirements:
#   - Docker + Docker Compose, Go (to build the recipe-service image), pnpm.
#   - A Playwright browser with OS deps, installed once with:
#       pnpm --filter @pantry/web exec playwright install --with-deps chromium
#     (the sandbox/CI needs libnspr4, libnss3, libgbm1, libasound2).
#
# Env knobs:
#   E2E_KEEP_STACK=1   leave the compose stack running afterwards (debugging).
#   E2E_PORT=5174      run the Vite dev server on a different port (see below).
#
# Extra args after `pnpm test:e2e` are forwarded to `playwright test`
# (e.g. `pnpm test:e2e --headed --debug`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/e2e-stack.sh
. "$ROOT/scripts/lib/e2e-stack.sh"

# The Vite dev server's port. Overridable because a stale dev server left behind
# on the default port is silently *reused* by Playwright (`reuseExistingServer`
# is on outside CI), so the suite then exercises whatever that server is
# serving — someone else's branch — and reports it as your result. Both a false
# pass and a false failure are reachable that way. Set E2E_PORT to sidestep it.
# SITE_URL must track the port: Convex Auth validates its JWTs against the
# deployment's SITE_URL, so a mismatch fails every sign-up in the suite.
E2E_PORT="${E2E_PORT:-5173}"
export E2E_PORT
SITE_URL="http://localhost:${E2E_PORT}"

trap e2e_stack_teardown EXIT

e2e_stack_up "$SITE_URL"

# The web app imports @pantry/core (and the other workspace packages) through
# their published `dist/`, and Playwright starts the Vite *dev* server, which
# builds nothing. Without this the dev server cannot resolve them and every
# spec fails at the first render.
echo "==> building workspace packages the dev server resolves"
pnpm build --filter="@pantry/web^..."

echo "==> running Playwright (starts the Vite dev server)"
pnpm --filter @pantry/web exec playwright test "$@"

echo "==> e2e passed"
