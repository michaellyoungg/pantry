# Railway Deployment — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the code artifacts and the runbook needed to stand Pantry up on Railway, then perform the first deploy — done when the full loop works in a browser over the public internet.

**Architecture:** Everything code-shaped in this increment is built and verified against the **local compose stack** before Railway is touched. Two artifacts are new: a production web image (Node build → Caddy serve, with an SPA fallback) and `scripts/provision-convex.sh`, extracted from `e2e.sh` so production and e2e cannot drift. The Railway console work is a documented runbook, verified by a smoke checklist.

**Tech Stack:** Docker multi-stage builds, Caddy 2, pnpm + Turborepo, bash, self-hosted Convex CLI, Railway.

**Spec:** [`docs/superpowers/specs/2026-08-16-railway-deployment-design.md`](../specs/2026-08-16-railway-deployment-design.md)

## Global Constraints

- **Increment 1 only.** Increments 2 (automation), 3 (durability) and 4 (custom domain) are out of scope and get their own plans. Do not add `railway.toml`, GitHub Actions workflows, or backup jobs here.
- **Never regenerate the Convex Auth keypair against a deployment that has users.** Rotating `JWT_PRIVATE_KEY` signs out every existing session.
- `SITE_URL` (Convex deployment env) is the **web app's** origin. `CONVEX_SITE_URL` is the **backend's 3211** origin. They are different values; never set one from the other.
- `POSTGRES_URL` for the Convex backend is a **server URL with no database path**.
- `VITE_CONVEX_URL` is inlined at build time. Changing it requires a rebuild, not a variable edit.
- The Convex backend image is pinned **by digest**, matching `docker-compose.yml`. Never `:latest`.
- `DO_NOT_REQUIRE_SSL=true` on Railway is deliberate — read the spec's "Correction to BL-0008" before "fixing" it.
- Port `8099` is reserved by the integration suite. Use `8123` for local image smoke tests.
- Biome no-ops inside `.claude/worktrees`. Lint changed files by explicit path.

---

### Task 1: Production web image (Dockerfile + Caddyfile)

The web app is a Vite SPA using TanStack Router for client-side routing. Served naively, every deep link and every refresh outside `/` returns 404, because no file exists at `/plan`. The Caddy config must fall back to `index.html` for routes **while still returning a real 404 for missing assets** — otherwise a broken asset path silently returns HTML, and the browser fails with a confusing MIME-type error instead of a clear 404.

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/Caddyfile`
- Test: `scripts/smoke-web-image.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a build accepting `--build-arg VITE_CONVEX_URL=<url>`, listening on `$PORT` (default 8080), serving `apps/web/dist`. Task 4's runbook references this build argument by name.

- [ ] **Step 1: Write the failing test**

Create `scripts/smoke-web-image.sh`:

```bash
#!/usr/bin/env bash
# Verify the production web image (BL-0006 increment 1).
#
#   bash scripts/smoke-web-image.sh
#
# Builds the image and asserts the three behaviours that a naive static server
# gets wrong: the app renders at /, deep links fall back to index.html, and a
# MISSING ASSET still 404s rather than being handed the HTML fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE=pantry-web-smoke
# 8099 belongs to the integration suite; a stale listener there silently
# replaces the thing under test.
HOST_PORT=8123

echo "==> building $IMAGE"
docker build -f apps/web/Dockerfile \
  --build-arg VITE_CONVEX_URL=http://127.0.0.1:3210 \
  -t "$IMAGE" .

CID="$(docker run -d -e PORT=8080 -p "$HOST_PORT:8080" "$IMAGE")"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> waiting for the server"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

fail() {
  echo "FAIL: $*" >&2
  docker logs "$CID" >&2 2>&1 || true
  exit 1
}

echo "==> / serves the app shell"
curl -fsS "http://127.0.0.1:$HOST_PORT/" | grep -q 'id="root"' ||
  fail "/ did not serve the app shell"

echo "==> deep links fall back to index.html"
for route in /plan /list /recipes/catalog; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HOST_PORT$route")"
  [ "$code" = "200" ] || fail "$route returned $code, expected 200"
  curl -fsS "http://127.0.0.1:$HOST_PORT$route" | grep -q 'id="root"' ||
    fail "$route did not serve the app shell"
done

echo "==> a missing asset still 404s"
code="$(curl -sS -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:$HOST_PORT/assets/definitely-not-real.js")"
[ "$code" = "404" ] || fail "missing asset returned $code, expected 404"

echo "==> the Convex URL was inlined at build time"
docker exec "$CID" sh -c 'grep -rq "127.0.0.1:3210" /srv/assets' ||
  fail "VITE_CONVEX_URL was not inlined — check the ARG/ENV pair in the Dockerfile"

echo "==> web image smoke passed"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/smoke-web-image.sh`
Expected: FAIL at the build step — `failed to read dockerfile: open apps/web/Dockerfile: no such file or directory`

- [ ] **Step 3: Write the Caddyfile**

Create `apps/web/Caddyfile`. The split into two `handle` blocks is the whole point: `/assets/*` is served strictly, everything else falls back to the SPA shell.

```
# Production static server for the Vite SPA (BL-0006).
#
# Railway injects PORT. The two handle blocks are deliberate:
#   * /assets/* is served strictly, so a missing bundle returns 404 rather
#     than being handed index.html — which would surface in the browser as a
#     confusing MIME-type error instead of a clear missing-file error.
#   * everything else falls back to index.html, because TanStack Router owns
#     routing on the client and no file exists at /plan.
:{$PORT:8080} {
	root * /srv
	encode gzip

	handle /assets/* {
		file_server
	}

	handle {
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 4: Write the Dockerfile**

Create `apps/web/Dockerfile`. Note it builds from the **repo root** context, because the web app depends on four workspace packages that must be built first.

```dockerfile
# syntax=docker/dockerfile:1
#
# Production image for the web app (BL-0006).
#
# BUILD CONTEXT IS THE REPO ROOT, not apps/web:
#   docker build -f apps/web/Dockerfile --build-arg VITE_CONVEX_URL=... .
#
# @pantry/web imports @pantry/core, @pantry/types, @pantry/design-tokens and
# @pantry/convex through their built dist/. Building from apps/web alone
# resolves nothing and fails at the first import.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/recipe-service/package.json apps/recipe-service/
COPY packages/convex/package.json packages/convex/
COPY packages/core/package.json packages/core/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

COPY . .

# Vite inlines VITE_* at build time, so the Convex URL is baked into the
# bundle here. Changing it later means rebuilding this image.
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

# `@pantry/web...` is web AND its dependencies. The Go recipe-service is not a
# dependency of web, so its build task never runs and no Go toolchain is needed.
RUN pnpm build --filter=@pantry/web...

FROM caddy:2-alpine AS serve
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
EXPOSE 8080
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/smoke-web-image.sh`
Expected: PASS, ending with `==> web image smoke passed`

If the build fails on a missing workspace manifest, a package was added since this plan was written — add its `COPY` line next to the others.

- [ ] **Step 6: Commit**

```bash
git add apps/web/Dockerfile apps/web/Caddyfile scripts/smoke-web-image.sh
git commit -m "feat(BL-0006): production web image with an SPA fallback"
```

---

### Task 2: Extract `scripts/provision-convex.sh` from `e2e.sh`

`e2e.sh` steps 3–5 already are the provisioning procedure, and they duplicate helpers that `scripts/lib/convex-deployment.sh` already provides (`convex_cli`, `convex_admin_key`, `convex_wait_ready`). Extracting them gives production the same code path e2e exercises on every run.

This task is **behaviour-preserving**. Idempotency comes in Task 3; keep the two separate so a reviewer can reject one without the other.

**Files:**
- Create: `scripts/provision-convex.sh`
- Modify: `scripts/e2e.sh` (replace sections 3–5)
- Test: `pnpm test:e2e` — the existing suite is the regression test

**Interfaces:**
- Consumes: `scripts/lib/convex-deployment.sh` — `convex_cli`, `convex_admin_key`, `convex_wait_ready`, `convex_die`.
- Produces: `scripts/provision-convex.sh --site-url <url> --recipe-service-url <url>`, honouring `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `RECIPE_SERVICE_SECRET`, and the `COMPOSE` array. Exports nothing; prints the admin key it used on the last line. Task 3 adds `--preserve-auth-keys`; Task 4's runbook invokes it.

- [ ] **Step 1: Write the script**

Create `scripts/provision-convex.sh`:

```bash
#!/usr/bin/env bash
# Provision a self-hosted Convex deployment (BL-0006).
#
#   scripts/provision-convex.sh --site-url http://localhost:5173 \
#                               --recipe-service-url http://recipe-service:8090
#
# Sets the deployment environment and pushes the functions. This is the ONE
# procedure both e2e and production use, so the two cannot drift.
#
# Target selection follows scripts/lib/convex-deployment.sh:
#   CONVEX_SELF_HOSTED_URL        default http://127.0.0.1:3210
#   CONVEX_SELF_HOSTED_ADMIN_KEY  default: read from the compose container
#
# Requires RECIPE_SERVICE_SECRET in the environment — it must match the value
# the Go service runs with, or every recipe call 401s and the app renders as
# though the user owns nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/convex-deployment.sh
. "$ROOT/scripts/lib/convex-deployment.sh"

SITE_URL=""
RECIPE_SERVICE_URL=""

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
  -h | --help)
    sed -n '2,18p' "$0"
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

echo "==> setting Convex deployment env"
convex_cli env set SITE_URL "$SITE_URL"
convex_cli env set RECIPE_SERVICE_URL "$RECIPE_SERVICE_URL"
convex_cli env set RECIPE_SERVICE_SECRET "$RECIPE_SERVICE_SECRET"

echo "==> generating Convex Auth keys"
provision_write_auth_keys

echo "==> deploying Convex functions"
convex_cli dev --once

echo "==> provisioned $CONVEX_SELF_HOSTED_URL"
printf '%s\n' "$CONVEX_SELF_HOSTED_ADMIN_KEY"
```

- [ ] **Step 2: Add the keypair helper**

Still in `scripts/provision-convex.sh`, add this function **above** the argument parsing. It is lifted verbatim from `e2e.sh` — the `NAME=value` form and the newline-to-space conversion are both load-bearing.

```bash
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
  convex_cli env set "JWT_PRIVATE_KEY=$private_key"
  convex_cli env set "JWKS=$jwks"
}
```

- [ ] **Step 3: Make it executable and replace e2e.sh sections 3–5**

```bash
chmod +x scripts/provision-convex.sh
```

In `scripts/e2e.sh`, delete everything from `# --- 3. admin key + CLI target ---` through the `convex_cli dev --once` line of section 5, and the local `convex_cli()` definition near the top. Replace the deleted block with:

```bash
# --- 3-5. provision the deployment (shared with production, BL-0006) -------
export CONVEX_SELF_HOSTED_URL="$CONVEX_URL"
CONVEX_SELF_HOSTED_ADMIN_KEY="$(
  bash scripts/provision-convex.sh \
    --site-url "$SITE_URL" \
    --recipe-service-url "$RECIPE_SERVICE_INTERNAL_URL" | tail -n1
)"
export CONVEX_SELF_HOSTED_ADMIN_KEY
```

- [ ] **Step 4: Run the regression test**

Run: `pnpm test:e2e`
Expected: PASS, ending with `==> e2e passed`. This proves the extraction preserved behaviour — the suite signs up, creates a recipe, plans a day, generates the list and checks an item off, all of which depend on the auth keys and recipe-service wiring this script now sets.

If it fails at sign-in with `Could not verify OIDC token claim`, the two keys came from different keypairs — check that `provision_write_auth_keys` sets both from one `keys` value.

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-convex.sh scripts/e2e.sh
git commit -m "refactor(BL-0006): extract provision-convex.sh so e2e and prod share one path"
```

---

### Task 3: Idempotent production mode

e2e regenerates the keypair every run, which is correct for a throwaway stack and catastrophic for production: rotating `JWT_PRIVATE_KEY` signs out every existing session. Production needs a mode that sets the keypair **only when absent**.

Per the spec, this must be an explicit mode, not a flag someone remembers to pass — so the runbook in Task 4 always passes it, and the flag's absence is what e2e relies on.

**Files:**
- Modify: `scripts/provision-convex.sh`
- Test: manual, against the local compose stack (exact commands below)

**Interfaces:**
- Consumes: `provision_write_auth_keys` from Task 2.
- Produces: `--preserve-auth-keys`, which skips keypair generation when `JWT_PRIVATE_KEY` is already set on the deployment. All other env vars are still set on every run, so a rotated `RECIPE_SERVICE_SECRET` still propagates.

- [ ] **Step 1: Add the flag and the guard**

In `scripts/provision-convex.sh`, add `PRESERVE_AUTH_KEYS=0` next to the other variable initialisations, and this case to the argument parser:

```bash
  --preserve-auth-keys)
    PRESERVE_AUTH_KEYS=1
    shift
    ;;
```

Then replace the `echo "==> generating Convex Auth keys"` / `provision_write_auth_keys` pair with:

```bash
if [ "$PRESERVE_AUTH_KEYS" = "1" ] && provision_has_auth_keys; then
  echo "==> Convex Auth keys already set — preserving them"
else
  echo "==> generating Convex Auth keys"
  provision_write_auth_keys
fi
```

- [ ] **Step 2: Add the existence check**

Add next to `provision_write_auth_keys`:

```bash
# provision_has_auth_keys — true when the deployment already holds a private
# key. `convex env get` exits non-zero for an unset name, so its status is the
# whole answer; the output is a secret and is deliberately discarded.
provision_has_auth_keys() {
  convex_cli env get JWT_PRIVATE_KEY >/dev/null 2>&1
}
```

- [ ] **Step 3: Verify it preserves keys across two runs**

With the local stack up (`docker compose up -d postgres recipe-service convex-backend` and `.env` sourced):

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
set -a && . ./.env && set +a

bash scripts/provision-convex.sh --preserve-auth-keys \
  --site-url http://localhost:5173 \
  --recipe-service-url http://recipe-service:8090 >/dev/null

FIRST="$(pnpm --silent --filter @pantry/convex exec convex env get JWT_PRIVATE_KEY)"

bash scripts/provision-convex.sh --preserve-auth-keys \
  --site-url http://localhost:5173 \
  --recipe-service-url http://recipe-service:8090 >/dev/null

SECOND="$(pnpm --silent --filter @pantry/convex exec convex env get JWT_PRIVATE_KEY)"
[ "$FIRST" = "$SECOND" ] && echo "PASS: key preserved" || echo "FAIL: key rotated"
```

Expected: `PASS: key preserved`, and the second run prints `==> Convex Auth keys already set — preserving them`.

- [ ] **Step 4: Verify the e2e path still rotates**

Run: `pnpm test:e2e`
Expected: PASS. e2e does not pass `--preserve-auth-keys`, so it still mints a fresh keypair per run and stays self-isolating.

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-convex.sh
git commit -m "feat(BL-0006): --preserve-auth-keys so provisioning prod never signs users out"
```

---

### Task 4: The bootstrap runbook

**Files:**
- Create: `docs/railway-deploy.md`
- Modify: `docs/self-hosted-convex-ops.md` (point the deferred-items section at the spec)
- Modify: `README.md` (one line under Architecture)

**Interfaces:**
- Consumes: the build argument from Task 1, the script and flag from Tasks 2–3.
- Produces: the procedure Task 5 executes.

- [ ] **Step 1: Write `docs/railway-deploy.md`**

It must contain, in this order, with values copied verbatim from the spec's "The configuration contract":

1. **Prerequisites** — a Railway account, the `railway` CLI, and a password manager entry ready for `INSTANCE_SECRET`.
2. **The two circular dependencies**, stated up front so the operator is not surprised: the backend's origin variables need domains that do not exist until the service is created, and `SITE_URL` needs the web domain. Both resolve as create → read domain → set variable → redeploy.
3. **The nine bootstrap steps** from the spec's "Bootstrap order (first deploy)".
4. **The full variable tables** for all three configuration locations.
5. **The five must-agree pairs and their symptoms**, as a debugging table.
6. **A smoke checklist**: sign up, add a recipe, plan a day, generate the grocery list, check an item off, reload and confirm it persisted, then open a deep link (`/plan`) directly to confirm the SPA fallback works in production.
7. **The secrets that no backup contains** — `INSTANCE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`, `RECIPE_SERVICE_SECRET` — with the instruction to store them in a password manager immediately.

Two commands the operator will otherwise have to derive. Creating both databases:

```bash
railway connect Postgres
# then, at the psql prompt:
CREATE DATABASE pantry;
CREATE DATABASE convex_self_hosted;
```

And generating the admin key once the backend is healthy:

```bash
railway ssh --service convex-backend ./generate_admin_key.sh
```

- [ ] **Step 2: Cross-link the ops runbook**

In `docs/self-hosted-convex-ops.md`, under the "What is deferred to BL-0006" heading, add a line pointing at the spec, and flag the reversal explicitly so a future reader does not "fix" it back:

```markdown
> **Resolved.** These are answered in
> [`docs/superpowers/specs/2026-08-16-railway-deployment-design.md`](superpowers/specs/2026-08-16-railway-deployment-design.md).
> Note that the TLS item is **reversed** there: Railway's Postgres image ships a
> self-signed certificate and its private network is WireGuard-encrypted, so
> `DO_NOT_REQUIRE_SSL=true` stays. See that spec's "Correction to BL-0008".
```

- [ ] **Step 3: Update the README**

`README.md` currently says "Production targets Railway (self-hosted Convex + Postgres)." Extend it to link the runbook:

```markdown
Local development runs everything via `docker compose`. Production targets
Railway — see [`docs/railway-deploy.md`](docs/railway-deploy.md).
```

- [ ] **Step 4: Verify the docs are internally consistent**

Read `docs/railway-deploy.md` against the spec's contract tables and confirm every variable name matches exactly. A typo here surfaces as one of the five failure symptoms, hours later, in a browser.

Run: `pnpm backlog:index:check`
Expected: `docs/backlog/README.md index is up to date`

- [ ] **Step 5: Commit**

```bash
git add docs/railway-deploy.md docs/self-hosted-convex-ops.md README.md
git commit -m "docs(BL-0006): Railway bootstrap runbook"
```

---

### Task 5: Execute the first deploy

**This task requires the operator's Railway account and cannot be completed by an agent.** Its deliverable is a working deployment plus the answers to the spec's open risks.

**Files:**
- Modify: `docs/backlog/BL-0006-railway-deploy.md` (add a Progress section)
- Modify: `docs/railway-deploy.md` (correct it against what actually happened)

**Interfaces:**
- Consumes: everything above.
- Produces: a deployed app, and resolved answers to the five risks in the spec.

- [ ] **Step 1: Follow the runbook**

Work through `docs/railway-deploy.md` end to end. Expect it to be wrong in small ways on first contact — that is what this step is for.

- [ ] **Step 2: Resolve the five open risks and record each answer**

For each, write the actual finding into `docs/railway-deploy.md`:

1. Does Convex tolerate Railway's self-signed Postgres certificate, and can a CA be supplied instead of `DO_NOT_REQUIRE_SSL`?
2. Does a Convex action's `fetch` resolve `recipe-service.railway.internal`? **If not**, give `recipe-service` a public domain, set `RECIPE_SERVICE_URL` to it, and record that the private-only decision was reversed — `X-Service-Secret` still authenticates the caller.
3. Do Railway cron services run to completion and exit for the `seed` job?
4. Does `convex-backend` need to bind `::` for Railway's public proxy?
5. What does a week of steady state actually cost?

- [ ] **Step 3: Run the smoke checklist**

Sign up, add a recipe, plan a day, generate the grocery list, check an item off, reload, and open `/plan` directly. All seven must pass.

- [ ] **Step 4: Fix the runbook**

Amend `docs/railway-deploy.md` wherever reality differed. A runbook nobody has executed is a hypothesis.

- [ ] **Step 5: Record progress on the backlog item**

Add a `## Progress` section to `docs/backlog/BL-0006-railway-deploy.md` noting increment 1 complete, the deployed URLs, and which risks resolved which way. Leave `status: in-progress` — increments 2 and 3 remain.

- [ ] **Step 6: Commit**

```bash
git add docs/railway-deploy.md docs/backlog/BL-0006-railway-deploy.md
git commit -m "docs(BL-0006): record increment 1 deployment findings"
```

---

## Notes for the executor

- **Tasks 1–4 need no Railway account.** Only Task 5 does. If you are an agent, complete 1–4, then stop and hand Task 5 to the operator.
- Task 2's only real test is `pnpm test:e2e`, which needs Docker, Go and a Chromium install. If it has never been run in this environment: `pnpm --filter @pantry/web exec playwright install --with-deps chromium`.
- If a Convex CLI command appears to succeed but changes nothing, check that `CONVEX_SELF_HOSTED_URL` points at port **3210** — a wrong URL silently manages a different deployment.
