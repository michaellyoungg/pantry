---
id: BL-0008
title: Self-hosted Convex prod hardening
status: in-progress
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

## Alternatives considered

- Convex Cloud (managed) — zero ops, but off-platform and vendor-dependent;
  rejected in favor of the self-hosted philosophy. This item is the cost of that
  choice, made explicit.
