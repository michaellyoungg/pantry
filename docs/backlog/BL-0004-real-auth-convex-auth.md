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

**Specific gaps to close when this lands** (surfaced in Plan 2a review):
- `groceryList.toggleItem` patches any `groceryList` `_id` with no ownership
  check — an IDOR once there are multiple users. Add an ownership guard (verify
  the row's `userId` matches the caller) at auth time.
- Replace the hardcoded `DEV_USER_ID` reads in every Convex function and the Go
  service's `DevUserID` with the authenticated identity.
- **Guard the recipe-service mutations.** `DELETE`/`PUT /recipes/{id}` have no
  ownership check. Since BL-0002 landed the seeded catalog, these now expose
  *shared* system-owned rows (owner `catalog`, stable guessable ids like
  `cat-garlic-bread`) to mutation/deletion by any client — a bigger blast radius
  than per-user dev data. Enforce ownership (and treat catalog rows as
  read-only to end users) when identity lands.

## Alternatives considered

- Hosted provider (Clerk/Auth0) — viable, but Convex Auth keeps identity inside
  the chosen user-centric core. Revisit if requirements outgrow it.
