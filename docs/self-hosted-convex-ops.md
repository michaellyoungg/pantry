# Operating self-hosted Convex

Self-hosting Convex means we own the operations Convex Cloud would otherwise
run for us. This is the runbook for that ownership: what the deployment is made
of, how it is backed up, how a restore actually goes, how to upgrade it, who can
reach the dashboard, and how the credential that guards all of it is rotated.

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
static, unscoped credential on the public internet — one whose only revocation
is a restart of the whole deployment —
guarding the entire database. The convenience does not justify that, and
Railway's "private" networking mode makes a hosted dashboard awkward anyway —
which is the constraint BL-0008 flagged, resolved in the direction it was
already pushing.

Consequences to accept: the backend must be reachable from the operator's
machine (a tunnel if it is on private networking), and the CLI —
`convex env`, `convex export`, `convex run` — is the primary operational
interface, not the dashboard UI. That is already true of every script here.

Rotation of that key is covered in the next section. It has been drilled, and it
works — but its most important property is that it is *undoable*, so read the
warning before you rely on it.

---

## Rotating the admin key

> Everything in this section was executed against a scratch deployment and is
> re-checkable with `scripts/convex-rotate-drill.sh`. Where something could not
> be tested locally it is called out as untested rather than assumed.

### Two facts that determine the whole procedure

**Issuing a new admin key revokes nothing.** `generate_admin_key.sh` returns a
*different* key every time it is run, and every key it has ever returned for the
current secret stays valid. Handing someone a fresh key does not invalidate the
one they already have. Verified: two keys generated back-to-back from an
unchanged secret both authenticated (HTTP 200).

**So the instance secret is the only revocation lever.** The key is
`generate_key $INSTANCE_NAME $INSTANCE_SECRET`, and rotating it therefore *is*
changing `INSTANCE_SECRET`. There is no per-key revocation, no expiry, and no
key list to prune.

The secret is read by `read_credentials.sh` in this order — **environment
variable first**, then `/convex/data/credentials/instance_secret`, then a fresh
random one — and whichever wins is then written back to that file. The env var
takes precedence over the persisted value on *every* boot, which is what makes
rotation possible at all, and also what makes it reversible.

### The procedure

```bash
# 1. new secret
openssl rand -hex 32

# 2. put it in .env (CONVEX_INSTANCE_SECRET=…) AND in the secret store.
#    This is the step that makes the rotation stick — see the warning below.

# 3. restart the backend onto it (~3s of downtime)
docker compose up -d --force-recreate convex-backend

# 4. re-derive the key and update packages/convex/.env.local by hand
docker compose exec -T convex-backend ./generate_admin_key.sh

# 5. confirm: the old key is refused, the new one is accepted
probe() { curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://127.0.0.1:3210/api/query -H "Authorization: Convex $1" \
  -H 'Content-Type: application/json' \
  -d '{"path":"_system/cli/queryEnvironmentVariables:get","args":{},"format":"json"}'; }
probe "$OLD_KEY"   # expect 401
probe "$NEW_KEY"   # expect 200
```

`401` for the old key and `200` for the new one is the whole success condition.
Anything else means the restart did not pick the new secret up — check that
`.env` really changed and that step 3 *recreated* the container rather than
merely restarting it.

### The warning: rotation is reversible, so it is only as good as your `.env`

Because the environment variable beats the persisted file on every boot, a
deployment that is restarted with a stale `.env` **silently un-rotates itself
and brings the revoked key back to life.** Verified directly: restarting on the
previous secret returned the "revoked" key to HTTP 200 and made the new key 401.

There is no state anywhere that records "the old secret is burned". Practical
consequences:

- The rotation is not complete when the backend restarts. It is complete when
  **every copy of the old secret is gone** — `.env`, the secret store, CI
  variables, the hosting platform's config, and any operator's shell history or
  scratch file.
- A rollback of the deploy that carried the new secret is also a rollback of the
  rotation.
- If you are rotating because a key leaked, the leaked key is only dead for as
  long as nobody restores the old `INSTANCE_SECRET`.

Treat the instance secret as the credential and the admin key as a derived
artifact of it, because that is exactly what it is.

### What actually breaks, and what does not

Observed on the drill:

| | Effect |
| --- | --- |
| Backend availability | recreated; answered `/version` again **~3 s** later |
| Documents | **survive** — byte-for-byte identical across the rotation |
| Deployment env (`convex env`) | **survives** — including `JWT_PRIVATE_KEY`/`JWKS` |
| File storage | **survives** — uploaded files still fetch at the same URLs |
| Any pre-rotation admin key | **dead** — HTTP 401, `"The provided admin key was invalid for this instance"` |
| In-flight storage *upload* URLs | **dead** — `StorageTokenInvalid`, HTTP 401; an upload in progress fails and has to be retried |
| Dashboard browser session | must re-authenticate — paste the new key. The container itself holds no key (only `NEXT_PUBLIC_DEPLOYMENT_URL`), so it needs no redeploy |
| `packages/convex/.env.local` | **does not self-heal** — it holds a literal key and must be edited by hand, or every CLI command fails |
| `scripts/convex-backup.sh`, `-restore.sh`, the drills | self-heal — they derive a key from the running container rather than storing one |
| `recipe-service` | unaffected — it authenticates with `RECIPE_SERVICE_SECRET`, a separate credential |
| Signed-in end users | not invalidated *by design*: Convex Auth signs with `JWT_PRIVATE_KEY`, a deployment env var, and those survive. See the limits below |

The CLI is a poor way to notice a bad key: given a stale one it prints
`Failed to authenticate: "The provided admin key was invalid for this instance"`
and then enters a WebSocket reconnect loop rather than exiting. The raw HTTP
probe above fails immediately and is what the drill uses.

### The rotation drill

```bash
scripts/convex-rotate-drill.sh
```

Same reasoning as the restore drill — a recovery procedure nobody has run is a
hypothesis — with the extra motive that everything above is a behaviour of the
image's `read_credentials.sh`, not a documented API. A future backend image
could change it, and this repo would not otherwise notice. The drill asserts
each claim in this section, including the reversibility footgun, so an image
that changes the semantics fails the drill instead of quietly invalidating the
runbook.

**Safety.** Its own compose project (`pantry-keyrot`), its own *named* volumes
and its own shifted ports (`34xx`/`5544`) — clear of both the developer stack
and the restore drill, so all three can be up simultaneously. It refuses to run
under the `pantry` project. See `deploy/docker-compose.keyrot.yml`.

**Last verified:** 2026-08-03, against
`convex-backend@sha256:705b8d89…` on Postgres 17 — passed. Independently
re-checked by hand against the default **SQLite** backing, with identical
results, so the procedure is not specific to the Postgres configuration.

Run it on the upgrade cadence, alongside the restore drill.

### What could not be verified locally

Stated plainly, because the point of this section is that it is tested:

- **A signed-in browser session across a rotation was not exercised end to end.**
  What was verified is the mechanism it depends on: `JWT_PRIVATE_KEY` and `JWKS`
  are ordinary deployment env vars and survive the rotation unchanged, and the
  admin key is not involved in end-user auth. Sessions should therefore be
  unaffected — but that is an inference from two verified facts, not an observed
  login.
- **Hosted-platform restart semantics** (BL-0006). Everything above assumes you
  can recreate the backend container with a new environment variable and that it
  comes back on the same volume and database. Whether the hosting platform's
  env-var update triggers that recreation itself, how long its restart takes,
  and whether the volume reattaches cleanly are properties of a platform nobody
  has stood up yet.
- **Rotating `INSTANCE_NAME`.** The key is derived from the name as well as the
  secret, but the name is deployment identity rather than a credential, and
  changing it was not tested. Rotate the secret.

One operational note that bit this drill: `docker compose down` interpolates the
whole compose file, so it fails the `CONVEX_INSTANCE_SECRET`/`RECIPE_SERVICE_SECRET`
`:?` guards just like `up` does. A teardown run without those variables set
fails — and if you have redirected its output, fails silently, leaving the stack
running and its ports held.

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
