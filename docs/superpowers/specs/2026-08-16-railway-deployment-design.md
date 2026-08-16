# Railway deployment — self-hosted Convex, private Go service, static web

**Date:** 2026-08-16
**Backlog item:** BL-0006
**Status:** design approved, not yet implemented

## Problem

Everything runs on a laptop. `docker compose up` gives the full stack, and
[`docs/self-hosted-convex-ops.md`](../../self-hosted-convex-ops.md) hardened
every operational question that could be answered without a hosted environment —
then deliberately stopped at the environment-specific edge. BL-0008 left a list
of questions marked "deferred to BL-0006" precisely because guessing at them
would have been fiction.

This design answers them against a real target: **Railway, for real daily use.**
Not a demo that gets reseeded, not a staging environment — an app whose data
someone would be upset to lose.

That framing is what makes the durability sections load-bearing rather than
ceremonial. A demo can run Convex on SQLite on a container disk. This cannot.

## Goals

1. The full loop works over the public internet: sign up, add a recipe, plan a
   day, generate the aggregated grocery list, check items off, reload.
2. Convex's transactional store is **Postgres**, not a SQLite file on a disk.
3. Recipes *and* Convex documents have off-host backups, on a schedule, with an
   alert that fires when backups **stop happening** — not merely when one fails.
4. A restore has actually been performed against the deployed configuration.
5. Moving to a custom domain later is one documented procedure, not a rebuild.
6. Steady-state cost stays in the ~$20–30/month band (Railway Hobby).

## Non-goals (YAGNI)

- **No production observability stack.** Alloy + Grafana LGTM stay a local,
  opt-in profile. Telemetry is a documented no-op when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, so production simply leaves it unset.
  Revisit when there is a production incident worth tracing.
- **No Convex dashboard service.** `docs/self-hosted-convex-ops.md` already
  decided the dashboard is not publicly exposed and the CLI is the operational
  interface. Running it in production would be cost and attack surface for a UI
  nobody can reach.
- **No high availability, no multi-region, no autoscaling.** One household.
- **No coordinated web/Convex release gating** (see "Accepted risks").
- **No custom domain in the first increments** — deferred to increment 4.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Convex hosting | Self-hosted on Railway | Re-affirms BL-0006/BL-0008. Convex Cloud was reconsidered and rejected again — see "Alternatives considered" |
| Convex store | Postgres from day one | Migrating SQLite → Postgres later is a snapshot-and-restore, not a config flip; the backend comes up *empty* on Postgres |
| Postgres instances | **One**, two databases | `pantry` + `convex_self_hosted` on a single Railway Postgres. Two instances doubles cost for a household-scale app |
| Convex ports | Two generated domains on one service | Railway maps one domain to one target port; the backend needs both 3210 (API) and 3211 (site — `http.ts` registers Convex Auth routes) |
| recipe-service exposure | **Private only** | Only Convex calls it. No public domain removes an entire attack surface at zero cost |
| Postgres TLS | `DO_NOT_REQUIRE_SSL=true` | Railway's Postgres image ships a *self-signed* certificate; the private network is already WireGuard-encrypted. See "Correction to BL-0008" |
| Web hosting | Static build, Caddy, own Dockerfile | Needs an SPA fallback; a root-context build because it depends on four workspace packages |
| Convex functions deploy | GitHub Actions on `main` | Functions live in git, not in any Railway service |
| Backup destination | Cloudflare R2 | 10 GB free, zero egress, S3-compatible |
| Backup alerting | Dead-man's-switch | Alert on *absence* of a success ping, not on job failure |
| Domain | Railway subdomains initially | No domain owned yet; swap procedure documented in increment 4 |

## Correction to BL-0008

`docs/self-hosted-convex-ops.md` and BL-0006 both carry a deferred instruction:
drop `DO_NOT_REQUIRE_SSL` "so the backend requires TLS to a managed database."

Against Railway that instruction does not cleanly apply, and following it
literally would be worse than not following it. Railway's Postgres image
generates a **self-signed** certificate, so a client that requires verified TLS
has no trusted chain to verify against. Meanwhile all inter-service traffic on
Railway's private network is WireGuard-encrypted, so the transport is already
confidential without application-layer TLS.

The decision is therefore to **keep `DO_NOT_REQUIRE_SSL=true` on the private
network and document why**, rather than claim a TLS posture that was not
achieved. Whether Convex's Postgres client can instead be handed a custom CA is
listed as a task to verify, not an assumption — if it can, prefer that.

This is a genuine reversal of a previously written instruction. It is recorded
here rather than silently applied, and the ops runbook should be updated to
point at this section.

## Topology

One Railway project, one `production` environment: four long-running services
plus two cron jobs.

| Service | Public? | Notes |
|---|---|---|
| `postgres` | private | Postgres 17 + volume. Databases `pantry` and `convex_self_hosted`. Railway automated backups on |
| `convex-backend` | 2 domains | Pinned image digest (same as compose). Volume at `/convex/data`. Domain A → **3210**, domain B → **3211**. `restart: on-failure` |
| `recipe-service` | **none** | Existing Dockerfile, `server` stage. Reached at `recipe-service.railway.internal:8090` |
| `web` | 1 domain | Static Vite build served by Caddy. This is the app URL |
| `seed` | none | Cron, daily. Same Dockerfile, `seed` stage |
| `backup` | none | Cron, nightly. Increment 3 |

Three constraints this forces:

1. **`convex_self_hosted` must be created by hand, once.**
   `deploy/postgres-init/10-convex-db.sql` only runs on a first boot against an
   empty data directory of the *compose* image; Railway uses its own Postgres
   image and will never execute it. Without the database the backend exits with
   `FATAL: database "convex_self_hosted" does not exist`. Create `pantry` the
   same way.
2. **`POSTGRES_URL` is a server URL with no database path** — the backend
   appends its own. Its mere presence is what flips the image's `run_backend.sh`
   from `--db sqlite` to `--db postgres-v5`, so an empty value silently keeps
   SQLite.
3. **The `web` service builds from the repo root**, not `apps/web`. It depends
   on `@pantry/core`, `@pantry/types`, `@pantry/design-tokens` and
   `@pantry/convex`, which must be built first. Building from `apps/web` alone
   reproduces the stale-`dist` failure this repo has already hit.

The backend's volume stays load-bearing even with Postgres backing: uploaded
files (`/convex/data/storage`) and the instance credentials
(`/convex/data/credentials`) live there, and no `pg_dump` would capture them.

## The configuration contract

Configuration lives in **three** places and only one of them is Railway. This
is the entire risk surface of the deployment.

### 1. Railway service variables

| Service | Variable | Value |
|---|---|---|
| `convex-backend` | `INSTANCE_SECRET` | `openssl rand -hex 32`, **new for production**. Immutable after first boot |
| | `POSTGRES_URL` | `postgres://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432` — no database path |
| | `DO_NOT_REQUIRE_SSL` | `true` |
| | `CONVEX_CLOUD_ORIGIN` | the 3210 domain, `https://` |
| | `CONVEX_SITE_ORIGIN` | the 3211 domain, `https://` |
| | `DISABLE_BEACON` / `RUST_LOG` / `DOCUMENT_RETENTION_DELAY` | `true` / `info` / `172800` |
| `recipe-service` | `DATABASE_URL` | `postgres://…@postgres.railway.internal:5432/pantry?sslmode=disable` |
| | `PORT` | `8090` |
| | `RECIPE_SERVICE_SECRET` | `openssl rand -hex 32`, new for production |
| | `ANTHROPIC_API_KEY` / `FDC_API_KEY` | optional; unset degrades gracefully by design |
| `web` | `VITE_CONVEX_URL` | the 3210 domain — **inlined at build time** |

`OTEL_EXPORTER_OTLP_ENDPOINT` is deliberately unset everywhere.

### 2. Convex deployment environment

Set with `convex env set`, stored **inside the backend**, invisible to Railway:

- `SITE_URL` — the **web app's** origin
- `RECIPE_SERVICE_URL` — `http://recipe-service.railway.internal:8090`
- `RECIPE_SERVICE_SECRET` — identical to the Go service's value
- `JWT_PRIVATE_KEY` and `JWKS` — one RS256 keypair

`CONVEX_SITE_URL` is injected by the backend and read by `auth.config.ts`. It is
the backend's **3211** origin and is *not* `SITE_URL`. Conflating the two is the
most likely configuration mistake in this design.

### 3. The operator's shell

`CONVEX_SELF_HOSTED_URL` (the 3210 domain) and `CONVEX_SELF_HOSTED_ADMIN_KEY`
(from `./generate_admin_key.sh` inside the container). Point these at the wrong
URL and the CLI silently manages a different deployment than the app uses.

### Pairs that must agree, and how each fails

| Must match | Symptom |
|---|---|
| `RECIPE_SERVICE_SECRET`: Railway ↔ Convex env | Every recipe call 401s; the app renders as if the user owns nothing |
| `JWT_PRIVATE_KEY` ↔ `JWKS` (one keypair) | `Could not verify OIDC token claim` on sign-in |
| Convex `SITE_URL` ↔ web's public domain | Auth rejects the origin |
| `VITE_CONVEX_URL` ↔ 3210 domain | App cannot reach the backend — **and the fix is a rebuild, not a variable edit** |
| `INSTANCE_SECRET` ↔ `/convex/data/credentials` | Backend will not come up against its own data |

### Secrets that no backup contains

`INSTANCE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS` and `RECIPE_SERVICE_SECRET` are not
in a Convex snapshot. Lose `INSTANCE_SECRET` and a perfect backup restores into
a backend that cannot read it. **They go into a password manager on day one**,
plus one `convex-backup.sh --include-env` snapshot whenever they change.

## Deployment pipeline

- **`recipe-service`** — root directory `apps/recipe-service`, existing
  Dockerfile (its final stage is `server`, so the default build is correct).
  Watch `apps/recipe-service/**`.
- **`web`** — root directory `/`, watch `apps/web/**`, `packages/**`,
  `pnpm-lock.yaml`. Requires a **new `apps/web/Dockerfile`**: a Node stage
  running `pnpm turbo build --filter=@pantry/web...`, then Caddy serving `dist`.
  The SPA fallback (`try_files {path} /index.html`) is mandatory — TanStack
  Router does client-side routing, so without it every deep link and every
  refresh outside `/` returns 404. Caddy binds `:{$PORT}`.
- **`convex-backend`** — no build; pinned digest, matching compose. Bumping it
  is the documented image-upgrade procedure in the ops runbook, not a Railway
  action.
- **`seed`** — same Dockerfile, `--target seed`, as a Railway **cron** service
  (cron services run to completion and exit rather than restart-looping). Daily.
  The seed upserts by stable id, so it is idempotent, and a schedule means
  catalog changes in code apply themselves rather than needing a remembered
  manual step.
- **Convex functions** — `.github/workflows/deploy-convex.yml`, on pushes to
  `main` touching `packages/convex/**`, running
  `pnpm --filter @pantry/convex deploy` with `CONVEX_SELF_HOSTED_URL` and
  `CONVEX_SELF_HOSTED_ADMIN_KEY` as repository secrets. This is why the 3210
  domain is public: the CLI is the only management interface, since no
  dashboard runs.

`railway.toml` per service captures **build and deploy settings only**. Secrets
and domains stay in the dashboard. The bootstrap is a runbook, not IaC, because
of the circular dependencies below.

### Extract provisioning from e2e.sh

`scripts/e2e.sh` steps 3–5 already *are* the provisioning procedure: generate
the admin key, set deployment env, push functions. Lift them into
`scripts/provision-convex.sh`, parameterised by deployment URL, and have
`e2e.sh` call it — so production and e2e cannot drift.

**One difference is critical.** e2e regenerates the auth keypair on every run.
Production must generate it **once and never again**, because rotating
`JWT_PRIVATE_KEY` signs out every existing session. The production path must be
idempotent — set only what is absent — and that must be an explicit mode of the
script, not a flag someone remembers to pass.

## Bootstrap order (first deploy)

The first deploy is not one-shot. Two genuine circular dependencies force it:

- `CONVEX_CLOUD_ORIGIN` / `CONVEX_SITE_ORIGIN` must hold domains that do not
  exist until the service has been created.
- Convex's `SITE_URL` must hold the web app's domain, which does not exist until
  the web service has been created.

Both resolve as "create → read the generated domain → set the variable →
redeploy." The order:

1. Create the project and the Postgres service. Create both databases by hand.
2. Deploy `convex-backend` with `INSTANCE_SECRET` and `POSTGRES_URL`. Add two
   domains with target ports 3210 and 3211. Set the two origin variables to
   those domains. Redeploy.
3. Generate the admin key inside the container; store it.
4. Deploy `recipe-service` (private, no domain).
5. Deploy `web`; note its generated domain.
6. Run `scripts/provision-convex.sh` — `SITE_URL`, `RECIPE_SERVICE_URL`,
   `RECIPE_SERVICE_SECRET`, and the one-time keypair.
7. Push Convex functions.
8. Run the `seed` service once.
9. Smoke test: sign up, add a recipe, plan a day, generate the list, check an
   item off, reload.

## Durability

Four things must survive an incident, and on Railway they live in four places:

| Piece | Where | Recovered by |
|---|---|---|
| Convex documents, indexes, scheduled jobs | Postgres `convex_self_hosted` | `convex import` of a snapshot |
| Uploaded files + instance credentials | `convex-backend` volume | snapshot with `--include-file-storage`; credentials from the secret store |
| **Recipes, ingredients, catalog** | Postgres `pantry` | `pg_dump` / `pg_restore` |
| Functions and schema | git | `pnpm --filter @pantry/convex deploy` |

The third row is the one BL-0008's table does not emphasise, and it is the
easiest to get wrong: **a Convex snapshot does not contain the recipes.** They
live in the Go service's Postgres. Backing up only Convex would restore a user
whose meal plan references recipe ids that no longer exist.

### Where the backup job runs

A **Railway cron service** on the private network, nightly, doing both:
`scripts/convex-backup.sh` (reused unchanged) and a `pg_dump` of `pantry`, then
uploading both to Cloudflare R2.

GitHub Actions was the first choice — off-host by construction, free failure
notifications — but `pg_dump` would then require exposing Postgres publicly via
a TCP proxy. Opening the database to the internet in order to back it up is a
bad trade. Railway cron keeps Postgres private.

### Alerting on absence, not failure

A job that errors sends a notification. A job that **never runs** — suspended
service, billing block, deleted cron — sends nothing, and that is the failure
mode that actually bites, because "we have backups" stays believed.

The job therefore pings a dead-man's-switch (healthchecks.io free tier) on
**success**, and the checker alerts when an expected ping does not arrive.
Failure alerting alone is exactly the trap BL-0008 warned about.

Retention is an R2 lifecycle rule rather than the script's `--keep`, so
retention survives the job being broken.

### The drill

`scripts/convex-restore-drill.sh` proves the *procedure*, not this environment.
The hosted version uses a throwaway Railway `drill` environment: restore the
latest snapshot and `pg_dump` into it, verify sign-in and a recipe read, tear it
down. This closes BL-0006's "run the drill against the deployed configuration."
An untested restore is a hypothesis.

Railway's own automated Postgres and volume backups stay enabled as cheap
defence-in-depth, but they live on Railway and therefore do not satisfy
"off-host."

## Increments

1. **Stand it up.** Manual bootstrap per the runbook; `apps/web/Dockerfile` +
   `Caddyfile`; `scripts/provision-convex.sh`. Ships
   `docs/railway-deploy.md`. Done when the full loop works in a browser.
2. **Automate.** `railway.toml` per service, watch paths,
   `.github/workflows/deploy-convex.yml`, `seed` as a daily cron. Done when a
   merge to `main` reaches the site without anyone opening Railway.
3. **Durability.** `backup` cron → R2, dead-man's-switch, R2 lifecycle
   retention, restore drill in a `drill` environment. Done when a restore has
   actually been performed — not when the job is green.
4. **Custom domain.** Deferred until a domain is owned: swap `SITE_URL`, both
   backend origins, and rebuild web for `VITE_CONVEX_URL`.

## Verification

Increment 1 is verified by a **manual smoke checklist**, not by pointing the
Playwright suite at production. The suite would work — it signs up a fresh
unique account per run and is self-isolating — but it would accumulate junk
accounts in a database that is now real. Revisit if a trimmed read-only smoke
spec becomes worth it.

Increment 3's verification *is* the restore drill.

## Risks to verify (tasks, not assumptions)

1. Whether Convex's Postgres client tolerates Railway's self-signed certificate,
   and whether a CA can be supplied instead of `DO_NOT_REQUIRE_SSL`.
2. **Highest risk:** whether a Convex action's `fetch` resolves
   `recipe-service.railway.internal` over the IPv6 private network from inside
   the V8 isolate. Fallback if not: give `recipe-service` a public domain and
   rely on `X-Service-Secret` — which is precisely what that secret exists for.
   This degrades the design rather than blocking it.
3. Railway cron run-to-completion semantics for `seed` and `backup`.
4. Whether `convex-backend` must bind `::` for Railway's public proxy. Note
   Railway's private network is IPv6; environments created after 2025-10-16 are
   dual-stack. The Go service listens on `":"+PORT`, which is Go's dual-stack
   wildcard, so it is already correct.
5. Whether steady-state usage actually lands in the $20–30 band. Railway bills
   *actual* usage, not allocated limits, so a mostly-idle backend with a 4 GB
   ceiling should cost far less than 4 GB — but this is a projection.

## Accepted risks

- **Web and Convex functions deploy independently**, so a schema change can
  briefly meet an older bundle. For a single-household app, a coordinated
  release mechanism costs more than the failure it prevents.
- **No HA.** A Railway incident is downtime. Acceptable for meal planning.
- **The 3210 domain is public** so the CLI can manage the deployment. It is
  protected by the admin key, whose rotation procedure is already drilled
  (BL-0048).

## Alternatives considered

- **Convex Cloud instead of self-hosting.** Reconsidered rather than assumed,
  because "real daily use" makes the self-hosting operations burden real instead
  of theoretical: the free tier would absorb the backend, its backups and the
  dashboard, deleting increment 3 almost entirely. Rejected again, consistent
  with BL-0006 and BL-0008, on the all-local / one-platform philosophy. Recorded
  here so the trade is explicit rather than inherited.
- **Convex on SQLite plus a volume.** Cheapest and fastest. Rejected for real
  daily use: a single file on a container disk, no point-in-time recovery, and
  the later move to Postgres is a snapshot-and-restore migration rather than a
  config flip.
- **Two Postgres instances**, one per service. Cleaner failure isolation, but
  roughly doubles the largest line item for a household-scale workload.
- **The official Convex Railway template.** A useful reference, but it bundles
  its own Postgres and an unpinned image, and this design deviates on both.
- **Backups from GitHub Actions.** Off-host by construction, but would require
  exposing Postgres publicly for `pg_dump`.
