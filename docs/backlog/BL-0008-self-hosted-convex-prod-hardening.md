---
id: BL-0008
title: Self-hosted Convex prod hardening
status: done
area: infra
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

Self-hosting Convex means we own operations that Convex Cloud would handle.
Verified viable (mid-2026) with official Docker images + Railway template, but it
is earlier-adopter than Cloud and we own the guardrails.

## Proposal

Before relying on self-hosted Convex in production:

- Pin specific image versions (never `:latest`). ✅ **Done** (branch
  `myoung/feat-pin-convex-images`): `docker-compose.yml` pins
  `convex-backend`/`convex-dashboard` by immutable digest with an update
  procedure in-comment. Convex tags self-hosted images by git commit SHA (no
  semver), so digest is the correct pin.
- Point Convex at Postgres (not SQLite) in the same region; size ~4GB RAM.
- Set up persistent storage + automated backups + a restore drill.
- Establish an upgrade process and changelog-watching cadence.
- Decide dashboard access model (unavailable in Railway "private" mode).

The remaining bullets are prod-deployment concerns (they land with BL-0006
Railway deploy); only the image-version pin is actionable in the local skeleton.

## Outcome

The runbook is [`docs/self-hosted-convex-ops.md`](../self-hosted-convex-ops.md).
The original framing above turned out to be too pessimistic: everything except
the environment-specific bullets was actionable against the compose stack, and
"actionable" included *verifying* it rather than describing it.

**Done:**

- **Postgres backing** — `deploy/docker-compose.convex-postgres.yml`. Kept as an
  override, not the default, so pulling it cannot silently re-point a developer
  stack at an empty database.
- **Persistent storage** — documented as four distinct things that have to
  survive an incident (Postgres, the data volume's file storage, instance
  credentials, and the functions in git), because "we have backups" is usually
  false about at least one of them. A `pg_dump` alone restores a deployment
  whose file references all dangle.
- **Backups** — `scripts/convex-backup.sh` (snapshot export including file
  storage, manifest recording the git commit, retention pruning, opt-in and
  loudly-warned env capture) and `scripts/convex-restore.sh`.
- **A restore drill, actually run** — `scripts/convex-restore-drill.sh`. Seeds a
  throwaway Postgres-backed deployment, backs it up, destroys it and its
  volumes, rebuilds, restores, and verifies every document returned. Passing
  2026-08-03. It asserts the rebuilt deployment is empty *before* restoring, so
  a pass cannot be an artifact of data that never went away.
- **Upgrade process** — `scripts/convex-upgrade-rehearsal.sh` boots the
  currently pinned image, seeds it, then swaps to a candidate image against the
  same database and volume and verifies the data survived. A cadence nobody can
  execute safely is not a process; this makes the first step of it testable.
- **Dashboard access model** — decided: not publicly exposed. The admin key is
  unscoped, grants full database and env access, and is derived from
  `INSTANCE_SECRET`; the dashboard runs locally on demand against the remote
  backend instead. Rotation is the one thing that could not be verified without
  disturbing a live deployment — split out as
  [BL-0048](BL-0048-convex-admin-key-rotation.md) rather than assumed.

**Found while drilling:** the backend does not retry its first database
connection, and the base `pg_isready` healthcheck reports ready during Postgres's
TCP-less initialization phase. Together those make a cold start a coin flip and
any later Postgres restart a permanent outage. Both fixed in the Postgres
override (TCP healthcheck, bounded `restart: on-failure`). This is the concrete
argument for drills over documentation: the bug was invisible until something
actually destroyed and rebuilt a deployment.

**Deferred to [BL-0006](BL-0006-railway-deploy.md)** — genuinely
environment-specific, and guessing at an unbuilt platform produces documentation
that is wrong in ways nobody notices until it matters: backup scheduling and
off-host destination, backup-failure alerting, volume provisioning and growth
alarms, managed-Postgres sizing/region/TLS, and the tunnel the dashboard model
depends on. Listed in the runbook and appended to BL-0006's scope.

## Alternatives considered

- Convex Cloud (managed) — zero ops, but off-platform and vendor-dependent;
  rejected in favor of the self-hosted philosophy. This item is the cost of that
  choice, made explicit.
