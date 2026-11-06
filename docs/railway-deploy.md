# Deploying Pantry to Railway

The bootstrap procedure for the production deployment: one Railway project, one
`production` environment, self-hosted Convex on Postgres, a private Go service,
and the web app as a static site.

The design and the reasoning behind every choice here are in
[`superpowers/specs/2026-08-16-railway-deployment-design.md`](superpowers/specs/2026-08-16-railway-deployment-design.md).
This document is the procedure only. Where the two disagree, the spec is the
authority and this file is stale.

This is **increment 1**: a manual bootstrap. Automating it (`railway.toml`,
deploy-on-merge, a cron seed) is increment 2, and off-host backups with a
restore drill are increment 3. Until increment 3 lands, **this deployment has
no off-host backups**, so treat the data as losable and do not put anything in
it you would be upset to lose.

> **Not yet executed.** Nobody has run this procedure end to end. It is derived
> from the design, from `docker-compose.yml`, and from the provisioning the e2e
> suite already performs, so the variable names and the ordering are real, but
> expect small things to be wrong on first contact. Correcting this file as you
> go is part of the work, not an afterthought: a runbook nobody has executed is
> a hypothesis.

## Prerequisites

- A Railway account on a paid plan. The steady-state projection is the $20-30
  per month band, and that is a projection, not a measurement.
- The `railway` CLI, logged in (`railway login`, then `railway whoami`).
- A password manager entry ready **before** you start. Four secrets created
  during this procedure exist in no backup; see
  [Secrets that no backup contains](#secrets-that-no-backup-contains).
- Docker locally, if you want to verify the web image before deploying it:
  `bash scripts/smoke-web-image.sh`.

The `railway` invocations below are written as the design specifies them. The
CLI's exact flag spellings were not verified against an installed CLI, so check
`railway <command> --help` if one is rejected, and fix it here when it is.

## Two circular dependencies, up front

Neither is a mistake in the procedure. Both are inherent, and both resolve the
same way: create the service, read the domain Railway generated, set the
variable to it, redeploy.

1. **The Convex backend's origin variables need its own domains.**
   `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` must hold the backend's public
   domains, which do not exist until the service has been created.
2. **Convex's `SITE_URL` needs the web app's domain**, which does not exist
   until the web service has been created.

So the first deploy of a service is expected to come up misconfigured. That is
normal here, and the redeploy is what fixes it.

## Bootstrap

### 1. Project and Postgres, with both databases created by hand

Create the project and add a Postgres service with a volume.

Then create both databases yourself. `deploy/postgres-init/10-convex-db.sql`
runs only on the first boot of an empty data directory of the **compose**
Postgres image; Railway runs its own image and will never execute it. Without
`convex_self_hosted` the backend exits with
`FATAL: database "convex_self_hosted" does not exist`.

```bash
railway connect Postgres
```

```sql
CREATE DATABASE pantry;
CREATE DATABASE convex_self_hosted;
```

One Postgres instance holds both, deliberately: two instances roughly doubles
the largest line item for a one-household workload.

### 2. Convex backend, then its two domains, then redeploy

Deploy `convex-backend` from the image pinned **by digest** in
`docker-compose.yml`. Never `:latest`: Convex tags self-hosted images by git
commit SHA rather than semver, so the digest is the only immutable reference.
Bumping it is the upgrade procedure in
[`self-hosted-convex-ops.md`](self-hosted-convex-ops.md), not a Railway action.

Attach a volume at `/convex/data`. It stays load-bearing even on Postgres:
uploaded files (`/convex/data/storage`) and the generated instance credentials
(`/convex/data/credentials`) live there, and no `pg_dump` captures them.

Set **all three** of `INSTANCE_SECRET`, `POSTGRES_URL` and
`DO_NOT_REQUIRE_SSL=true` (see
[the variable tables](#railway-service-variables)), then deploy.

`DO_NOT_REQUIRE_SSL` has to be there for the **first** boot, not added
afterwards: Railway's Postgres ships a self-signed certificate, so without it
this first deploy fails on a TLS error. The spec's bootstrap step 2 names only
the first two variables, which is a defect in the spec's ordering rather than a
difference of opinion; it should be corrected to match this.

Now add **two** domains to this one service, because Railway maps one domain to
one target port and the backend needs both:

| Domain | Target port | What |
|---|---|---|
| A | `3210` | the API. This is `CONVEX_SELF_HOSTED_URL` and `VITE_CONVEX_URL` |
| B | `3211` | the site origin, where `http.ts` registers the Convex Auth routes |

Set `CONVEX_CLOUD_ORIGIN` to domain A and `CONVEX_SITE_ORIGIN` to domain B, both
with `https://`, and redeploy.

### 3. Generate the admin key and store it

```bash
railway ssh --service convex-backend ./generate_admin_key.sh
```

This derives a key from the instance credentials the backend already persisted.
It does not restart or reconfigure anything. Put the key in the password manager
now: it is the only management interface, because no dashboard runs.

### 4. recipe-service, private

Deploy from `apps/recipe-service` with its existing Dockerfile. Its final stage
is `server`, so the default build is correct.

Set its variables from [the variable tables](#railway-service-variables) before
deploying: `DATABASE_URL`, `PORT`, and `RECIPE_SERVICE_SECRET`. Without them it
crash-loops. **Generate `RECIPE_SERVICE_SECRET` here, and keep it**: step 6 sets
the identical value on the Convex deployment, and if the two ever differ every
recipe call 401s and the app renders as though the user owns nothing.

**Give it no domain.** Only Convex calls it, so no public domain removes an
entire attack surface at zero cost. It is reached at
`recipe-service.railway.internal:8090`.

### 5. Web, and note its domain

Root directory `/` (the repo root, **not** `apps/web`), Dockerfile
`apps/web/Dockerfile`, and the variables from
[the variable tables](#railway-service-variables).

The root context is required: `@pantry/web` resolves `@pantry/core`,
`@pantry/types`, `@pantry/design-tokens` and `@pantry/convex` through their
built `dist/`, so they have to be built first. Building from `apps/web` alone
resolves nothing.

Pass the Convex API domain as a **build argument**, not a runtime variable:

```
VITE_CONVEX_URL=https://<domain A>
```

Vite inlines `VITE_*` at build time. Changing it later is a rebuild, not a
variable edit, and that is the one failure in the table below whose fix is not
"edit a variable and redeploy".

Note the domain Railway generates for this service. It is the app URL and it is
what `SITE_URL` must become in the next step.

### 6. Provision the Convex deployment

From a checkout, with the admin key from step 3:

```bash
export CONVEX_SELF_HOSTED_URL=https://<domain A>
export CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key>
export RECIPE_SERVICE_SECRET=<the same value recipe-service runs with>

bash scripts/provision-convex.sh --preserve-auth-keys \
  --site-url https://<the web domain> \
  --recipe-service-url http://recipe-service.railway.internal:8090
```

Both exports are required, not conventional: with `--preserve-auth-keys` the
script refuses to run unless `CONVEX_SELF_HOSTED_URL` and
`CONVEX_SELF_HOSTED_ADMIN_KEY` are set explicitly, because both otherwise
resolve to the local compose stack and a production run would silently
reconfigure your laptop instead.

`--preserve-auth-keys` is **mandatory in production and must never be omitted.**
Without it the script mints a fresh RS256 keypair, and rotating
`JWT_PRIVATE_KEY` invalidates every session that has ever been issued. The e2e
suite omits the flag on purpose, which is what makes each run self-isolating.

Everything other than the keypair is set on every run, so a rotated
`RECIPE_SERVICE_SECRET` still propagates.

This is the same script the browser e2e suite runs on every push, and the
nightly mobile runner too, which is the point: production and e2e cannot drift,
because there is one procedure.

### 7. Push the Convex functions

`scripts/provision-convex.sh` finishes by pushing them. To push again later,
with the same two exports in your shell:

```bash
pnpm --filter @pantry/convex exec convex dev --once
```

### 8. Seed the shared catalog, once

Run the recipe-service image's `seed` stage against `pantry`. Without it,
`GET /catalog`, the `/recipes/catalog` route, add-catalog-recipe-to-basket and
catalog-sourced recommendations are all empty for every user.

Recipes upsert by stable id, so re-running is inert. Increment 2 makes this a
daily cron so catalog changes in code apply themselves.

### 9. Smoke test

Work the [smoke checklist](#smoke-checklist). All seven steps must pass.

## The configuration contract

Configuration lives in **three** places and only one of them is Railway. This
is the entire risk surface of the deployment.

### Railway service variables

| Service | Variable | Value |
|---|---|---|
| `convex-backend` | `INSTANCE_SECRET` | `openssl rand -hex 32`, **new for production**. Immutable after first boot |
| | `POSTGRES_URL` | `postgres://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432` |
| | `DO_NOT_REQUIRE_SSL` | `true` |
| | `CONVEX_CLOUD_ORIGIN` | domain A (port 3210), with `https://` |
| | `CONVEX_SITE_ORIGIN` | domain B (port 3211), with `https://` |
| | `DISABLE_BEACON` | `true` |
| | `RUST_LOG` | `info` |
| | `DOCUMENT_RETENTION_DELAY` | `172800` |
| `recipe-service` | `DATABASE_URL` | `postgres://…@postgres.railway.internal:5432/pantry?sslmode=disable` |
| | `PORT` | `8090` |
| | `RECIPE_SERVICE_SECRET` | `openssl rand -hex 32`, new for production |
| | `ANTHROPIC_API_KEY` | optional (URL-import fallback); unset degrades by design |
| | `FDC_API_KEY` | optional (live nutrition lookups); unset degrades by design |
| | `PRICING_STORE_PROVIDER` | leave **unset**. Real store prices are opt-in and off is the shipped state |
| `web` | `VITE_CONVEX_URL` | domain A. **A build argument, inlined at build time** |

Two traps in `POSTGRES_URL`:

- **No database path.** The backend appends its own. A path here breaks it.
- **Its mere presence** is what flips the image's `run_backend.sh` from
  `--db sqlite` to `--db postgres-v5`. An empty value silently keeps SQLite,
  and you get a working deployment backed by a file on a container disk.

`OTEL_EXPORTER_OTLP_ENDPOINT` is deliberately unset everywhere. Telemetry is a
documented no-op without it, and the Grafana stack stays a local, opt-in
profile.

`DO_NOT_REQUIRE_SSL=true` is deliberate. Do not "fix" it: Railway's Postgres
image ships a **self-signed** certificate, so a client requiring verified TLS
has no chain to verify against, while Railway's private network is already
WireGuard-encrypted. This reverses an earlier instruction in
[`self-hosted-convex-ops.md`](self-hosted-convex-ops.md); the spec's "Correction
to BL-0008" records why.

### Convex deployment environment

Set with `convex env set`, stored **inside the backend**, invisible to Railway.
`scripts/provision-convex.sh` sets all of these.

| Variable | Value |
|---|---|
| `SITE_URL` | the **web app's** origin |
| `RECIPE_SERVICE_URL` | `http://recipe-service.railway.internal:8090` |
| `RECIPE_SERVICE_SECRET` | identical to the Go service's value |
| `JWT_PRIVATE_KEY` | one RS256 private key, PKCS8, newlines stored as spaces |
| `JWKS` | the public half of **that same** keypair |

`CONVEX_SITE_URL` is injected by the backend and read by `auth.config.ts`. It is
the backend's **3211** origin and it is **not** `SITE_URL`. Conflating the two
is the most likely configuration mistake in this design, so it is worth saying
twice: `SITE_URL` is where the browser loads the app, `CONVEX_SITE_URL` is where
Convex serves its auth routes.

### The operator's shell

| Variable | Value |
|---|---|
| `CONVEX_SELF_HOSTED_URL` | domain A (3210) |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | from step 3 |

Point these at the wrong URL and the CLI silently manages a different
deployment than the app uses, reporting success the whole time.

## Pairs that must agree, and how each fails

Every one of these fails at a distance from its cause, which is why they are
tabulated rather than left to be rediscovered.

| Must match | Symptom |
|---|---|
| `RECIPE_SERVICE_SECRET`: Railway ↔ Convex env | every recipe call 401s; the app renders as if the user owns nothing |
| `JWT_PRIVATE_KEY` ↔ `JWKS` (one keypair) | `Could not verify OIDC token claim` on sign-in |
| Convex `SITE_URL` ↔ the web app's public domain | auth rejects the origin |
| `VITE_CONVEX_URL` ↔ domain A | the app cannot reach the backend, **and the fix is a rebuild, not a variable edit** |
| `INSTANCE_SECRET` ↔ `/convex/data/credentials` | the backend will not come up against its own data |

## Secrets that no backup contains

`INSTANCE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS` and `RECIPE_SERVICE_SECRET` are
**not** in a Convex snapshot.

Lose `INSTANCE_SECRET` and a perfect backup restores into a backend that cannot
read it. Lose the keypair and every existing session is void.

**Put all four in a password manager on day one**, and take one
`scripts/convex-backup.sh --include-env` snapshot whenever any of them changes.

## Smoke checklist

All seven, in a browser, against the public URL:

1. Sign up for a new account.
2. Create a recipe.
3. Plan a day with it.
4. Generate the aggregated grocery list.
5. Check an item off.
6. Reload, and confirm the checked item persisted.
7. Open `https://<the web domain>/plan` **directly**, in a fresh tab. This is
   the SPA fallback: TanStack Router owns routing on the client, so without the
   Caddy `try_files` fallback every deep link and every refresh outside `/`
   returns 404 in production while working perfectly in dev.

Step 7 is the one that only fails in production, so it is the one most worth
doing deliberately.

The Playwright suite is deliberately **not** pointed at production. It would
work, since it signs up a fresh unique account per run, but it would accumulate
junk accounts in a database that is now real.

## Risks to resolve on first contact

The design lists five open questions that only a real environment can answer.
Record the actual finding here as you hit each one.

1. Whether Convex's Postgres client tolerates Railway's self-signed
   certificate, and whether a CA can be supplied instead of
   `DO_NOT_REQUIRE_SSL`.
2. **Highest risk:** whether a Convex action's `fetch` resolves
   `recipe-service.railway.internal` over the IPv6 private network from inside
   the V8 isolate. If it does not, give `recipe-service` a public domain, set
   `RECIPE_SERVICE_URL` to it, and record that the private-only decision was
   reversed. `X-Service-Secret` still authenticates the caller, which is
   precisely what that secret is for. This degrades the design rather than
   blocking it.
3. Whether Railway cron services run to completion and exit, for `seed`
   (increment 2) and `backup` (increment 3).
4. Whether `convex-backend` needs to bind `::` for Railway's public proxy.
   Railway's private network is IPv6; environments created after 2025-10-16 are
   dual-stack. The Go service listens on `":"+PORT`, Go's dual-stack wildcard,
   so it is already correct.
5. What a week of steady state actually costs. Railway bills actual usage rather
   than allocated limits, so a mostly-idle backend with a 4 GB ceiling should
   cost far less than 4 GB.

One more, added during increment 1: `scripts/provision-convex.sh` decides
whether a keypair already exists by looking for `JWT_PRIVATE_KEY` in
`convex env list --names-only`. Confirm on the first run that the name appears
there once set. If it does not, `--preserve-auth-keys` silently regenerates the
keypair on every provision and signs everyone out.
