# Operating self-hosted Convex

Self-hosting Convex means we own the operations Convex Cloud would otherwise
run for us. This is the runbook for that ownership: what the deployment is made
of, how it is backed up, how a restore actually goes, how to upgrade it, and who
can reach the dashboard.

Scope note: everything here is exercised against the local `docker compose`
stack, which is the only self-hosted deployment that exists today. The hosted
deployment lands with [BL-0006](backlog/BL-0006-railway-deploy.md); the parts
that cannot be settled until then are called out in
[What is deferred](#what-is-deferred-to-bl-0006) rather than guessed at.

---

## What the deployment is made of

Four things have to survive an incident, and they live in four different places.
Losing track of which is which is the usual way a "we have backups" story turns
out to be false.

| Piece | Where it lives | Recovered by |
| --- | --- | --- |
| Documents, indexes, scheduled jobs | Postgres `convex_self_hosted` (or the SQLite file, by default) | `convex import` from a snapshot |
| Uploaded files (`_storage`) | the backend's data volume, `/convex/data/storage` | `convex import` from a snapshot taken with `--include-file-storage` |
| Instance credentials (`INSTANCE_SECRET`, instance name) | the backend's data volume, `/convex/data/credentials`, and `.env` | re-supplied from `.env` / the secret store |
| Functions and schema | this git repository | `pnpm --filter @pantry/convex deploy` |

Two consequences worth internalising:

- **A database dump is not a backup of Convex.** Uploaded files are on the
  container's volume, not in Postgres. A `pg_dump` alone restores a deployment
  whose file references all dangle.
- **A snapshot is not a backup of the deployment.** It contains no functions and
  no environment variables. A recovery is always "redeploy the code, re-set the
  env, then restore the data" — in that order, for the reason in
  [Restoring](#restoring).

---

## Backing store: Postgres, not SQLite

By default the backend keeps everything in a single SQLite file on its data
volume. That is a reasonable laptop default and a poor production one: no
replication, no point-in-time recovery, and the durability story reduces to "do
not lose that disk".

`deploy/docker-compose.convex-postgres.yml` moves the transactional store onto
Postgres:

```bash
docker compose -f docker-compose.yml \
               -f deploy/docker-compose.convex-postgres.yml up -d
```

It is an override rather than the default so that pulling this change does not
silently re-point an existing developer stack at an empty database. The base
`docker-compose.yml` is unchanged and still runs on SQLite.

Sizing: the Convex self-hosting guidance is roughly **4 GB RAM** for the backend,
with Postgres **in the same region** — the backend is chatty with its database
and cross-region latency shows up directly in function execution time. Both are
sizing decisions for the hosted environment; see
[What is deferred](#what-is-deferred-to-bl-0006).

### Two things that will bite you

**Convex does not create its database.** Given a `POSTGRES_URL` server URL the
backend connects to a database named `convex_self_hosted` and exits if it is
missing:

```
ERROR common::errors: db error: FATAL: database "convex_self_hosted" does not exist
Error: db error: FATAL: database "convex_self_hosted" does not exist
```

`deploy/postgres-init/10-convex-db.sql` creates it, but Postgres runs
`/docker-entrypoint-initdb.d` **only on a first boot against an empty data
directory**. On a Postgres that already has data, create it by hand:

```bash
docker compose exec postgres \
  psql -U pantry -d postgres -c 'CREATE DATABASE convex_self_hosted'
```

**The backend does not retry its first database connection.** It exits. That
turns two ordinary events into an outage, and the override handles both:

- *Cold start.* `pg_isready -U pantry` over the Unix socket succeeds against the
  short-lived initialization server the Postgres entrypoint runs to apply the
  init scripts — a server that deliberately does not listen on TCP. Compose
  marks Postgres healthy, `depends_on: service_healthy` releases the backend,
  and it dies with `FATAL: the database system is starting up`. The override
  probes over TCP (`pg_isready -U pantry -h 127.0.0.1`) instead, which stays
  unhealthy until the real server is accepting connections. This was not
  theoretical — it is what the first upgrade rehearsal actually hit.
- *Anything later.* A Postgres restart, failover or network blip is equally
  fatal. The override sets `restart: on-failure:20` on the backend so it retries
  instead of staying down until a human notices. Bounded rather than
  `unless-stopped`, so a genuinely broken configuration comes to rest instead of
  crash-looping forever.

### Moving an existing deployment to Postgres

Switching the flag is **not** a migration. A backend that comes up on Postgres
starts empty; its SQLite file is still on disk, simply unread. Move the data
across explicitly:

```bash
# 1. snapshot the running SQLite-backed deployment
scripts/convex-backup.sh

# 2. bring it up on Postgres (empty)
docker compose -f docker-compose.yml \
               -f deploy/docker-compose.convex-postgres.yml up -d

# 3. redeploy functions, then restore the data
pnpm --filter @pantry/convex deploy
scripts/convex-restore.sh .backups/<timestamp>/snapshot.zip --yes
```

Keep the SQLite file until you have confirmed the new deployment. It is the only
rollback.

---

## Backups

```bash
scripts/convex-backup.sh                      # -> ./.backups/<UTC timestamp>/
scripts/convex-backup.sh --out /srv/backups --keep 14
scripts/convex-backup.sh --include-env        # also capture deployment env
```

Each run writes `snapshot.zip` — a Convex snapshot export **including file
storage** — plus a `manifest.txt` recording the source URL and the git commit,
so a restore knows which commit's functions belong with the data. `--keep N`
prunes older backups.

This is deliberately the *logical* backup rather than a `pg_dump`:

- it is identical whether the deployment is on SQLite or Postgres,
- it captures uploaded files, which no database dump can see, and
- it is the only format `convex import` can restore.

Run `pg_dump` as well if you want a physical Postgres backup for point-in-time
recovery. It complements the snapshot; it does not replace it.

**`--include-env` writes secrets to disk.** `JWT_PRIVATE_KEY`, `JWKS` and
`RECIPE_SERVICE_SECRET` land in `env.txt` (mode 600) in plaintext. Use it only
when the backup destination is somewhere you would be willing to store the
secrets themselves. Without it, keep those values in the secret store and accept
that a recovery re-sets them by hand.

Cadence, retention and where backups are *stored* are hosted-environment
decisions — see [What is deferred](#what-is-deferred-to-bl-0006). Locally, the
script is manual and `.backups/` is gitignored.

---

## Restoring

```bash
scripts/convex-restore.sh .backups/<timestamp>/snapshot.zip --yes
```

The script runs `convex import --replace-all`, which deletes every document the
snapshot does not contain. It refuses to run without `--yes` for that reason.

A full recovery is four steps, and the order matters:

1. Bring up an empty backend — `docker compose up -d convex-backend`
2. **Redeploy the functions** — `pnpm --filter @pantry/convex deploy`
3. Re-set the deployment env — `convex env set ...` (`SITE_URL`,
   `RECIPE_SERVICE_URL`, `RECIPE_SERVICE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`;
   `scripts/e2e.sh` shows the full set)
4. Restore the data — `scripts/convex-restore.sh <snapshot> --yes`

Step 2 has to come before step 4: an import validates against the *deployed*
schema, so restoring into a schema-less backend gives you untyped tables that
look fine until something reads them.

---

## The restore drill

> A backup you have never restored is a hypothesis.

```bash
scripts/convex-restore-drill.sh
```

The drill is the experiment. It stands up a throwaway Postgres-backed
deployment, seeds known data, backs it up, **destroys the deployment and its
volumes**, rebuilds it empty, restores, and fails unless every document came
back byte-for-byte — modulo `_id` and `_creationTime`, which an import re-mints
by design.

It also proves the negative: between the destroy and the restore it asserts the
rebuilt deployment is genuinely empty, so a pass cannot be an artifact of data
that was never actually gone. And it asserts `convex_self_hosted.documents`
exists before starting, so a silent fallback to SQLite fails the drill instead
of quietly passing it.

**Safety.** The drill runs under its own compose project (`pantry-drill`) with
its own *named* volumes and shifted host ports (`33xx`/`55xx`) — see
`deploy/docker-compose.drill.yml`. Named volumes are namespaced by project, so
the `down -v` it issues cannot reach the developer stack's `./.data` bind
mounts, and it refuses to run under the `pantry` project at all. It is safe to
run while the normal stack is up.

Run it whenever the backup or restore path changes, and before any image
upgrade.

**Last verified:** 2026-08-03, against
`convex-backend@sha256:705b8d89…` on Postgres 17 — passed, 5/5 documents
restored across `groceryList` and `pantryItems` with identical contents.

The fixtures in `scripts/fixtures/convex-drill/` deliberately cover the cases a
naive round-trip loses: an optional field present on some rows and absent on
others, a non-default boolean, and both members of a union. **If you add a field
to a drilled table, add a row that exercises it.**

---

## Upgrades and changelog watching

Both Convex images are pinned by immutable digest in `docker-compose.yml`.
Convex tags the self-hosted images by git commit SHA rather than semver, so
there is no version range to read and a digest is the only meaningful pin. The
consequence is that upgrading is always a deliberate edit — which is the point,
but it also means nothing reminds you.

**Cadence.** Check monthly, and whenever a Convex client-library bump lands via
Dependabot (`convex` in `packages/convex/package.json`) — a client substantially
newer than the backend is the most likely source of a self-hosted mismatch.
Watch releases on `get-convex/convex-backend` and the self-hosting docs.

**Procedure.**

```bash
# 1. see whether there is anything to take
docker pull ghcr.io/get-convex/convex-backend:latest
docker image inspect ghcr.io/get-convex/convex-backend:latest \
  --format '{{index .RepoDigests 0}}'

# 2. rehearse it before touching the pin
CONVEX_CANDIDATE_IMAGE="ghcr.io/get-convex/convex-backend@sha256:…" \
  scripts/convex-upgrade-rehearsal.sh

# 3. only then edit the pin, both images together
# 4. back up, upgrade, and run the drill against the new pin
scripts/convex-backup.sh
scripts/convex-restore-drill.sh
```

The rehearsal answers the one question that matters: **will the new image come
up on the old image's data?** It seeds a scratch deployment on the *currently
pinned* image, snapshots it, recreates the backend on the candidate against the
same Postgres database and the same data volume, and verifies every document is
still readable and unchanged. A fresh-database smoke test would happily pass for
an image that cannot migrate existing data, which is precisely the failure that
costs you a deployment.

Passing does not make an upgrade risk-free — it exercises this repo's schema and
a handful of rows, not the whole dataset. Take a backup before the real bump
regardless.

Keep `convex-backend` and `convex-dashboard` on digests published together; a
mismatched pair is an untested combination.

**Status as of 2026-08-03:** a newer backend digest
(`sha256:467964cc…`) exists upstream and **passes the rehearsal** against the
currently pinned image's data. The pin is deliberately left alone here — bumping
it restarts the running deployment, so it belongs in its own change, made by
someone who is watching.

---

## Dashboard access model

The dashboard is a static front end that talks to the backend's HTTP API and
authenticates with an **admin key**. That key is not a user account: it grants
full read/write over every document and every environment variable, and it is
derived from `INSTANCE_SECRET` (`generate_admin_key.sh` → `generate_key
$INSTANCE_NAME $INSTANCE_SECRET`). There is no per-user login, no scoping, and
no revocation short of changing the instance secret.

**Decision: the dashboard is not exposed publicly.** Locally it is on
`http://127.0.0.1:6791`, bound to the host, which is fine. For the hosted
deployment, the intended model is to run the dashboard container *locally,
on demand*, pointed at the remote backend, with the admin key held in the
operator's secret store:

```bash
docker run --rm -p 6791:6791 \
  -e NEXT_PUBLIC_DEPLOYMENT_URL=https://<backend-host> \
  ghcr.io/get-convex/convex-dashboard@sha256:…
```

Rationale: a permanently-hosted dashboard puts a login form backed by a single
static, unscoped, effectively un-rotatable credential on the public internet,
guarding the entire database. The convenience does not justify that, and
Railway's "private" networking mode makes a hosted dashboard awkward anyway —
which is the constraint BL-0008 flagged, resolved in the direction it was
already pushing.

Consequences to accept: the backend must be reachable from the operator's
machine (a tunnel if it is on private networking), and the CLI —
`convex env`, `convex export`, `convex run` — is the primary operational
interface, not the dashboard UI. That is already true of every script here.

**Not yet verified:** admin-key rotation. The key is derived from
`INSTANCE_SECRET`, so rotating it means changing that secret, and what a running
deployment does with its existing data when the instance secret changes has not
been tested. Filed as [BL-0048](backlog/BL-0048-convex-admin-key-rotation.md)
rather than asserted here.

---

## What is deferred to BL-0006

These bullets cannot be settled honestly against a laptop, and guessing at a
platform nobody has stood up yet produces documentation that is wrong in ways
nobody notices until it matters. They belong with
[BL-0006](backlog/BL-0006-railway-deploy.md):

- **Where backups are stored, and on what schedule.** `scripts/convex-backup.sh`
  is the mechanism and is environment-agnostic; the cron/scheduler that invokes
  it, the off-host destination, and the retention window are properties of the
  hosted environment. A backup that never leaves the host it is backing up is
  not a backup.
- **Backup monitoring.** An unattended backup that silently stops is worse than
  no backup, because it is believed. Needs an alert on the hosted scheduler.
- **Persistent-volume provisioning and its size/growth alarm.** The backend's
  data volume still holds file storage even on Postgres.
- **Postgres sizing, region pinning and managed-instance choice** (~4 GB RAM,
  same region as the backend), plus dropping `DO_NOT_REQUIRE_SSL` so the backend
  requires TLS to a managed database.
- **The tunnel or private-network path** the dashboard access model above
  depends on.
