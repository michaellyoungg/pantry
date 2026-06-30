---
id: BL-0006
title: Railway deployment
status: proposed
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

## Alternatives considered

- Railway in M1 — rejected; premature yak-shaving.
- Convex Cloud (managed) instead of self-hosted — rejected; self-hosting matches
  the all-local / one-platform philosophy. See BL-0008 for hardening.
