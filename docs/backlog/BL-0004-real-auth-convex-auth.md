---
id: BL-0004
title: Real authentication (Convex Auth)
status: proposed
area: auth
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md]
created: 2026-06-29
---

## Context

Milestone 1 builds the multi-tenant data model (every record carries a
`user_id`) but stubs identity to a fixed dev user. The expensive part
(user-scoping) is done; swapping in real identity is the cheap part deferred
here. Pantry is intended for others to use eventually.

## Proposal

Integrate Convex Auth as the identity provider. Replace the stubbed dev user
with real sessions; propagate the authenticated user id to recipe-service calls
(e.g. signed token / forwarded identity) so recipe ownership is enforced
server-side. Add login/signup UI.

## Alternatives considered

- Hosted provider (Clerk/Auth0) — viable, but Convex Auth keeps identity inside
  the chosen user-centric core. Revisit if requirements outgrow it.
