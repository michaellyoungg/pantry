---
id: BL-0048
title: Convex admin-key rotation procedure (verified, not assumed)
status: in-progress
area: infra
effort: S
related_specs: []
created: 2026-08-03
---

## Context

Split out of [BL-0008](BL-0008-self-hosted-convex-prod-hardening.md) rather than
asserted in the runbook, because it was the one claim that could not be tested
without disturbing a live deployment.

The self-hosted admin key is not a user account. It grants full read/write over
every document and every environment variable, there is no scoping, and there is
no per-user login. It is derived from the instance secret — the image's
`generate_admin_key.sh` is literally
`generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET"` — which means "rotate the
admin key" and "change `INSTANCE_SECRET`" are the same operation.

What that operation does to a deployment that already has data is unknown. The
secret is persisted to `/convex/data/credentials/instance_secret` on first boot
and read back on every subsequent one, so a deployment plausibly treats it as
identity rather than as a rotatable credential. Nobody has checked.

Until someone does, we have a credential that guards the entire database and no
tested way to revoke it — which is exactly the sort of thing that is fine right
up until the moment it is not (a leaked key, a departing operator, a laptop).

## Proposal

Answer it experimentally, using the scratch-stack pattern BL-0008 already
established (`scripts/convex-restore-drill.sh` and
`deploy/docker-compose.drill.yml` — its own compose project, own named volumes,
shifted ports, never the developer stack):

- Seed a scratch Postgres-backed deployment with known data.
- Change `INSTANCE_SECRET` and restart. Record what happens: does the backend
  come up, is the data still readable, is the old admin key rejected, is the new
  one accepted?
- Depending on the answer, write up either a straightforward rotation procedure
  or the real one — most likely "stand up a new deployment with a new secret and
  restore a snapshot into it", which is a restore drill with extra steps and is
  already proven to work.
- Add whichever it is to `docs/self-hosted-convex-ops.md`, replacing the
  "Not yet verified" note in the dashboard access section.
- If rotation turns out to be genuinely disruptive, say so plainly there and
  treat admin-key handling (who holds it, where, for how long) as the mitigation
  instead.

Worth extending into a `scripts/convex-rotate-drill.sh` if the procedure has
more than a couple of steps, on the same reasoning as the restore drill: a
recovery procedure nobody has run is a hypothesis.

## Alternatives considered

- **Document the assumed procedure now.** Rejected — an untested rotation
  procedure in a runbook is worse than an admitted gap, because it gets believed
  during an incident.
- **Test it against the live local deployment.** Rejected — it is shared, it has
  real data, and the whole question is whether this operation is destructive.
