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

> **Executed 2026-11-05.** The procedure below is what actually worked, not
> what was designed. First contact invalidated five of the design's decisions,
> and each correction is marked **CORRECTED** inline with the reason. The
> headline change: Convex is provisioned from Convex's own Railway template
> rather than assembled by hand, because the template encodes three of those
> corrections already. See [What first contact
> changed](#what-first-contact-changed).


## Prerequisites

- A Railway account on a paid plan. The steady-state projection is the $20-30
  per month band, and that is a projection, not a measurement.
- The `railway` CLI, logged in (`railway login`, then `railway whoami`).
- A password manager entry ready **before** you start. Four secrets created
  during this procedure exist in no backup; see
  [Secrets that no backup contains](#secrets-that-no-backup-contains).
- Docker locally, if you want to verify the web image before deploying it:
  `bash scripts/smoke-web-image.sh`.
- **An SSH keypair, registered with Railway.** `railway ssh` is the only way to
  reach a container, and both creating the second database and generating the
  admin key need it. There is no way round it:

  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''
  railway ssh keys add -k ~/.ssh/id_ed25519.pub -n "$(hostname)"
  ssh-keyscan -t ed25519 ssh.railway.com >> ~/.ssh/known_hosts
  ```

  The `ssh-keyscan` line matters in a non-interactive shell: without the host
  key on file, ssh tries to ask for confirmation, finds no askpass, and fails
  with `Host key verification failed`.

**Do not pass a secret to `railway add -v`.** The CLI echoes each variable it
sets, value included, to stdout. Create the service first, then set secrets with
`railway variable set`, which prints only the name.

**`railway` flattens `${{Service.VAR}}` references.** A reference passed through
`railway add -v` or `railway variable set` is resolved and stored as a literal,
so a later password rotation does not propagate. Variables that must stay live
references have to be set in the dashboard, or inherited from a template.


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

### 1. Project, then Convex and Postgres from Convex's template

```bash
railway init --name pantry
railway deploy -t convex-and-postgres-official
```

**CORRECTED.** The design said to create a Railway **managed** Postgres and put
both databases on it. That is impossible. Self-hosted Convex cannot connect to
Railway's managed Postgres at all:

- the backend attempts a TLS handshake and rustls rejects the certificate with
  `invalid peer certificate: Other(OtherError(CaUsedAsEndEntity))`, which is a
  CA certificate being used as a leaf. Trusting a CA does not fix that, so
  supplying one is not a workaround, and no build of the backend (checked both
  the pinned digest and `:latest`) has a CA or sslmode flag at all;
- `DO_NOT_REQUIRE_SSL=true` does **not** disable TLS. Its own help says "the
  persistence won't require SSL ... It would still prefer SSL if available.
  This should only be set in tests." The server offers TLS, so the client takes
  it and dies. The design's entire "Correction to BL-0008" section rests on
  this variable doing something it does not do.

The template instead runs **`postgres:17` as an ordinary service** with
`PGSSLMODE=disable` and `DO_NOT_REQUIRE_SSL=false`. With no TLS offered, the
backend's preference finds nothing and connects in plaintext over Railway's
WireGuard-encrypted private network, which is the security argument the design
already made. This is why Convex's template "bundles its own Postgres", which
the design dismissed in one line without establishing why it does that.

The template creates three services: `Postgres`, `convex-backend` and
`convex-dashboard`.

**Pin both images.** The template ships `:latest`, which the design forbids.
Resolve the digests and record what is running:

```bash
for i in convex-backend convex-dashboard; do
  docker pull "ghcr.io/convex/$i:latest"
  docker image inspect "ghcr.io/convex/$i:latest" --format '{{index .RepoDigests 0}}'
done
railway service source connect --service convex-backend  --image ghcr.io/convex/convex-backend@sha256:...
railway service source connect --service convex-dashboard --image ghcr.io/convex/convex-dashboard@sha256:...
```

Railway's API exposes no field for the digest a deploy actually pulled, so this
records the digest `:latest` points at *now*. If the deploy happened long
enough ago for `:latest` to have moved, pinning is an upgrade rather than a
record.

**Note the dashboard.** The design said not to run one in production. The
template includes it, and on a deployment you intend to operate by hand it is
where the admin key gets pasted. Keeping it is a deliberate reversal; delete the
service if you want the design's posture.

### 2. Create the second database

The template's Postgres comes up with one database, `convex_self_hosted`.
recipe-service needs `pantry` on the same instance:

```bash
railway ssh -s Postgres psql -U postgres -d convex_self_hosted -c 'CREATE DATABASE pantry;'
```

Postgres is reached over `railway ssh` rather than a TCP proxy on purpose: a
proxy would put the database on the public internet to run one statement.

**There is no two-domain step.** The design called for two generated domains on
the backend service, with target ports 3210 and 3211, because the site origin
needed its own port. **CORRECTED:** the template serves the site origin as a
**path** on the single public domain:

```
CONVEX_CLOUD_ORIGIN = https://<backend domain>
CONVEX_SITE_ORIGIN  = https://<backend domain>/http
```

So one domain is enough:

```bash
railway domain -s convex-backend -p 3210
railway domain -s convex-dashboard
```

The backend boots before a domain exists, so its origin variables resolve to
nothing on the first deploy. Redeploy after adding the domain:

```bash
railway redeploy -s convex-backend -y
curl -fsS https://<backend domain>/version   # prints "unknown"; a 200 is the signal
```

The template sets these as live `${{RAILWAY_PUBLIC_DOMAIN}}` references, so they
pick up the new domain on their own. Variables you set yourself through the CLI
would not: see the reference-flattening note in the prerequisites.


### 3. Generate the admin key and store it

```bash
railway ssh -s convex-backend ./generate_admin_key.sh
```

The key is `generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET"`, so it is a
deterministic function of those two values: the same pair always yields the same
key, and `INSTANCE_SECRET` is therefore the root credential rather than one
secret among several. `read_credentials.sh` resolves each from the environment,
then `/convex/data/credentials/<file>`, then a generated default, writing it back
to the volume either way, which is why that volume holds the root credential and
why `INSTANCE_SECRET` is immutable after first boot.

The **dashboard has no credential of its own** and no login of its own: it asks
you to paste this key.

**CORRECTED: `INSTANCE_NAME` matters, and the design never mentions it.** The
template sets `convex_self_hosted`, with underscores. The local compose stack
sets nothing, so it defaults to `convex-self-hosted`, with hyphens. That
difference broke `convex_admin_key` in `scripts/lib/convex-deployment.sh`, whose
`[a-z0-9-]+` prefix skipped the underscores and returned 81 of the key's 93
characters, silently. Fixed in michaellyoungg/pantry#235; a deployment running
without that fix derives an admin key that is rejected on every call.


### 4. recipe-service, private

```bash
railway add -s recipe-service
railway variable set -s recipe-service "DATABASE_URL=postgres://postgres:<pw>@postgres.railway.internal:5432/pantry?sslmode=disable"
railway variable set -s recipe-service PORT=8090
railway variable set -s recipe-service "RECIPE_SERVICE_SECRET=<new 32-byte hex>"
```

**Give it no domain.** Only Convex calls it, and that was verified to work (see
[What first contact changed](#what-first-contact-changed)), so it is reached at
`recipe-service.railway.internal:8090` and has no public surface.

**CORRECTED: the default build is not correct.** The design said "existing
Dockerfile, its final stage is `server`, so the default build is correct."
Railway's Railpack builder wins instead: it sees `apps/recipe-service/package.json`
(the thin manifest that lets turbo treat the Go service as a workspace), assumes
a Node app, and fails with `No start command detected` without ever reading the
Dockerfile. Railway has no `DOCKERFILE` builder value to select; setting
`dockerfilePath` is what switches it:

```bash
railway api 'mutation { serviceInstanceUpdate(
  serviceId: "<recipe-service id>", environmentId: "<env id>",
  input: { rootDirectory: "apps/recipe-service", dockerfilePath: "Dockerfile" }) }'
```

**CORRECTED: `railway up` archives the git repo root, not your shell's
directory.** Running it from `apps/recipe-service` still uploads the whole repo,
so with `rootDirectory` unset the Dockerfile is not at the archive root and the
build fails with `couldn't locate the dockerfile at path Dockerfile in code
archive`, after producing zero log lines. The working combination is: archive =
repo root, `rootDirectory` selects the service, `dockerfilePath` is relative to
it.

```bash
cd "$(git rev-parse --show-toplevel)" && railway up -s recipe-service -d -y
```

**CORRECTED, and the more dangerous half: `railway up` deploys your local
WORKING TREE.** Not `main`, not the pushed branch, not the commit the PR
merged: whatever is checked out and saved on disk at that moment, including
uncommitted edits. Nothing in the output says which commit it shipped, and the
deploy is reported as a success either way.

This has already produced a silent production/dev divergence. The seed service
was deployed to `production` from a branch carrying the Dockerfile change that
ships `/seed`, and to `dev` a few minutes later from a different branch cut
before that change merged. Both builds reported SUCCESS. Dev's image simply had
no `/seed` at the path its start command names, so the container died before
executing anything and produced **zero** log lines, in both `railway logs` and
the `buildLogs` API. The catalog stayed empty next to a green deploy, and the
cause was invisible from Railway entirely: the only way to see it was to diff
the working tree's Dockerfile against `main`.

So before any `railway up`, confirm what you are shipping:

```bash
git status --porcelain && git log --oneline -1
```

A dirty tree or a branch that is not the one you mean to deploy is the bug.
This is also the strongest argument for finishing increment 2: a git-triggered
deploy cannot ship a tree that exists only on one laptop.

A build that fails this way logs nothing through `railway logs --build`. Read it
with `railway api 'query { buildLogs(deploymentId: "...", limit: 200) { message } }'`
instead, which does return the real error.

A healthy start logs `store selected kind="postgres"` and
`recipe-service listening port="8090"`, plus one line per optional feature it is
degrading without (`ANTHROPIC_API_KEY unset`, and so on), which is the designed
behaviour rather than a warning.

### 5. Web, and note its domain

```bash
railway add -s web
railway variable set -s web "VITE_CONVEX_URL=https://<backend domain>"
railway api 'mutation { serviceInstanceUpdate(
  serviceId: "<web id>", environmentId: "<env id>",
  input: { dockerfilePath: "apps/web/Dockerfile" }) }'
cd "$(git rev-parse --show-toplevel)" && railway up -s web -d -y
railway domain -s web
```

`rootDirectory` stays unset here, because this image's context **is** the repo
root: `@pantry/web` resolves four workspace packages through their built
`dist/`.

`VITE_CONVEX_URL` is a service variable, which Railway passes to the Docker
build, and Vite inlines it. Set it before the first build; changing it later is
a rebuild, not a variable edit.


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

### 8. Seed the shared catalog

**CORRECTED: this needs its own service and a start-command override.** The
seed is a separate build stage of the recipe-service Dockerfile, and Railway's
service config has `dockerfilePath` and `startCommand` but **no Docker build
target**, so it will only ever build the final stage. The server image
therefore also ships `/seed` (michaellyoungg/pantry#237), which is what makes
this possible at all.

```bash
railway add -s seed
railway variable set -s seed --skip-deploys "DATABASE_URL=<same as recipe-service>"
railway api 'mutation { serviceInstanceUpdate(
  serviceId: "<seed id>", environmentId: "<env id>",
  input: { rootDirectory: "apps/recipe-service", dockerfilePath: "Dockerfile",
           startCommand: "/seed", cronSchedule: "0 7 * * *",
           restartPolicyType: NEVER }) }'
cd "$(git rev-parse --show-toplevel)" && railway up -s seed -d -y
railway cron run --service seed --yes      # deploying does NOT run it
railway cron list --service seed
```

A **cron service does not run when you deploy it**; it waits for its schedule,
and the deploy reporting `SUCCESS` only means the build succeeded. The first run
has to be triggered off-schedule, which is why the catalog can appear empty next
to a green deploy.

The run finishes with status `EXITED`, so Railway cron services do run to
completion rather than restart-looping. Expect 57 catalog recipes; the seed
upserts by stable id, so the daily schedule is inert when nothing changed.

Without this, `GET /catalog`, the `/recipes/catalog` route,
add-catalog-recipe-to-basket and catalog-sourced recommendations are empty for
every user.

### 9. Smoke test

Work the [smoke checklist](#smoke-checklist). All seven steps must pass.

## How code reaches each environment

**`dev` deploys itself from `main`; production is promoted by hand.** The
asymmetry is deliberate: production's schema must not run ahead of the web
bundle that uses it, so nothing reaches production without someone choosing it.

| Service | `dev` | `production` |
|---|---|---|
| `web`, `recipe-service`, `seed` | repo trigger on `main`, deploys once the commit's CI check suite passes | no trigger; promoted by hand |
| Convex functions | `.github/workflows/deploy-convex.yml` on a push to `main` that touches `packages/convex/` or the provisioning scripts | the same workflow, run by hand with `environment: production` |
| `Postgres`, `convex-backend`, `convex-dashboard` | pinned images, no trigger | pinned images, no trigger |

The pinned images never deploy on their own, correctly: an image bump is a
deliberate ops action.

Railway waits for GitHub's check suite for the commit, and GitHub reports one
suite per commit across every workflow, so a `dev` deploy is as slow as the
slowest CI job on `main`. That is why the browser e2e job is skipped on a push
to `main` (michaellyoungg/pantry#241).

Promoting a service to production still means `railway up` from a clean
checkout of the commit you mean, with the working-tree hazard described under
recipe-service. Promote the Convex functions in the same sitting, so the schema
and the code that reads it move together.

These triggers were created by hand in Railway, not from code. Capturing them,
with `watchPatterns` so an unrelated merge does not rebuild every service, is
what increment 2's `.railway/railway.ts` owes; `railway.toml` is obsolete, see
the deprecation note in [What first contact changed](#what-first-contact-changed).

## The configuration contract

Configuration lives in **three** places and only one of them is Railway. This
is the entire risk surface of the deployment.

### Railway service variables

| Service | Variable | Value |
|---|---|---|
| `convex-backend` | `INSTANCE_SECRET` | `openssl rand -hex 32`, **new for production**. Immutable after first boot |
| | `POSTGRES_URL` | `${{Postgres.CONVEX_DATABASE_URL}}` — a server URL, no database path. Set by the template as a live reference |
| | `INSTANCE_NAME` | `convex_self_hosted`. Half of the admin key; see step 3 |
| | `DO_NOT_REQUIRE_SSL` | `false`. **Not** `true`: it only *prefers* SSL and is documented as test-only. TLS is disabled server-side with `PGSSLMODE=disable` on Postgres instead |
| | `CONVEX_CLOUD_ORIGIN` | the backend's one domain, with `https://` |
| | `CONVEX_SITE_ORIGIN` | the same domain plus `/http` — a path, not a second domain or port |
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

## What first contact changed

Executed 2026-11-05 against project `pantry`. The loop works over the public
internet: sign-up and recipe creation both passed in a real browser, and the
recipe landed in the `pantry` database, so the whole path (browser → Convex Auth
→ a Convex action → recipe-service over the private network → Postgres) is
verified end to end.

The design listed five risks. Four are now answered:

1. **Can Convex use Railway's managed Postgres, with a CA instead of
   `DO_NOT_REQUIRE_SSL`?** **No, and no.** The certificate is a CA used as an
   end entity, which trust cannot repair, and no build of the backend accepts a
   CA or an sslmode. The managed instance is unusable; `postgres:17` as a
   service with `PGSSLMODE=disable` is the answer. This invalidates the design's
   Postgres topology decision *and* its "Correction to BL-0008".
2. **Does a Convex action's `fetch` resolve `recipe-service.railway.internal`
   from inside the V8 isolate?** **Yes.** This was the design's highest risk and
   it needs no mitigation: creating a recipe in the browser reached
   recipe-service over the private network and wrote to Postgres. The
   private-only decision stands, and `recipe-service` keeps no public domain.
4. **Must `convex-backend` bind `::` for Railway's proxy?** **No.** The template
   sets `PORT=3210` and the public domain targets it; the backend answers
   `/version` over the public internet unmodified.

Two remain open:

3. **Railway cron run-to-completion semantics** for `seed` and `backup`.
   **Answered: yes, they run to completion and exit** (`EXITED`), and they do
   **not** run on deploy, so the first run needs `railway cron run`. Getting
   there required shipping the seed binary in the server image, because Railway
   cannot select a Docker build target; see step 8.

One remains open:

5. **What a week of steady state costs.** Still a projection.

Two further corrections the design could not have anticipated:

- **`railway.toml` is deprecated.** The CLI warns that config-as-code files stop
  working after **2026-12-01** and points at `railway config migrate` and a
  code-based authoring file (`.railway/railway.ts`). Increment 2 planned to add
  `railway.toml` per service; it should adopt the authoring file instead. A
  `railway.toml` added during this deploy was also simply ignored — the
  `dockerfilePath` had to be set through the API.
- **The CLI leaks secrets and flattens references.** `railway add -v` echoes
  every value it sets to stdout, and both `add -v` and `variable set` resolve
  `${{Service.VAR}}` to a literal at submit time, so a variable that must track
  a rotated password cannot be set from the CLI at all.

## Risks the design listed

Superseded by [What first contact changed](#what-first-contact-changed), which
records the answers. Kept here only as the list the design asked to be closed.
