---
id: BL-0006
title: Railway deployment
status: in-progress
area: infra
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

Milestone 1 is local-first (docker compose). Standing up a deploy target before
there's a feature worth deploying is premature, and service shapes will churn
early. Deploy lands once the loop works and shapes settle. Trigger: "first time
I want to show someone."

## Proposal

Deploy to Railway:

- Self-hosted Convex via the official Railway template (Convex backend +
  dashboard + Postgres 17). Configure `CONVEX_SELF_HOSTED_ADMIN_KEY`,
  `INSTANCE_SECRET`, and origin settings.
- recipe-service + its Postgres as Railway services.
- web app as a static site.

Pin image versions (not `:latest`). Note: the Convex dashboard is unavailable in
Railway "private" mode.

### Inherited from BL-0008

[BL-0008](BL-0008-self-hosted-convex-prod-hardening.md) hardened everything that
could be settled against the compose stack and deliberately stopped at the
environment-specific edge — see
[`docs/self-hosted-convex-ops.md`](../self-hosted-convex-ops.md) for the runbook
those decisions live in. What is left needs a real Railway environment to answer:

- **Backup scheduling and an off-host destination.** `scripts/convex-backup.sh`
  is the mechanism and is environment-agnostic; the scheduler that invokes it,
  where the snapshots go, and the retention window are not. A backup that never
  leaves the host it backs up is not a backup.
- **Alerting on backup failure.** An unattended backup that silently stops is
  worse than none, because it is believed.
- **Persistent volume provisioning + a growth alarm.** The backend's data volume
  still holds file storage even with Postgres backing.
- **Managed Postgres: sizing (~4GB RAM), region pinning to match the backend,**
  and dropping `DO_NOT_REQUIRE_SSL` so the backend requires TLS.
- **The tunnel / private-network path** the dashboard access model assumes,
  since the dashboard is deliberately not exposed publicly.

Run `scripts/convex-restore-drill.sh` against the deployed configuration once it
exists — the local drill proves the procedure, not this environment.

## Alternatives considered

- Railway in M1 — rejected; premature yak-shaving.
- Convex Cloud (managed) instead of self-hosted — rejected; self-hosting matches
  the all-local / one-platform philosophy. See BL-0008 for hardening.

## Progress

**Increment 1 deployed 2026-11-05.** The loop works over the public internet:
sign-up and recipe creation passed in a real browser against the deployment, and
the recipe reached the `pantry` database, so browser → Convex Auth → a Convex
action → recipe-service over the private network → Postgres is verified end to
end. The procedure, and every way it diverged from the design, is in
[`docs/railway-deploy.md`](../railway-deploy.md).

Code shipped in michaellyoungg/pantry#232 (web image, `scripts/provision-convex.sh`,
`--preserve-auth-keys`, the runbook), with #233, #234 and #235 fixing a spec
defect, the renamed Convex ghcr path, and an admin-key parse that truncated on
an underscored instance name.

The catalog is seeded: 57 recipes, by a `seed` cron service running the binary
the server image now ships (#237), since Railway cannot select a Docker build
target. Railway cron services run to completion and exit, but do not run on
deploy, so the first run needs `railway cron run`.

Risks resolved: a Convex action's `fetch` **does** reach
`recipe-service.railway.internal` from the V8 isolate, so the private-only
decision stands and no public domain is needed; the backend needs no `::` bind.
Resolved negatively: Railway's **managed** Postgres cannot be used at all, so
Convex runs against a self-run `postgres:17` with TLS disabled server-side, and
the design's "Correction to BL-0008" is void.

Still open, and why this stays `in-progress`:

- **No off-host backups.** That is increment 3, and until it lands the
  deployment's data is losable. It is currently treated as a throwaway.
- **Increment 2 needs rethinking.** It planned a `railway.toml` per service;
  the CLI now warns config-as-code stops working after 2026-12-01 in favour of
  a code-based authoring file, and a `railway.toml` added during this deploy was
  ignored outright.
- **Steady-state cost** is still a projection, not a measurement.
