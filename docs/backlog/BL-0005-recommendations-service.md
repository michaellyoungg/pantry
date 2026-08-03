---
id: BL-0005
title: Recommendations / preference-lookup service
status: in-progress
area: recommendations
effort: L
related_specs: [2026-06-29-recipe-to-grocery-list-design.md, 2026-08-03-recommendations-design.md]
created: 2026-06-29
---

## Context

The core long-term goal is exploring fun recipes and doing recommendations —
"what should I make?" This is its own concern with its own data and likely its
own storage, distinct from the canonical recipe-service and the user-centric
Convex layer.

## Proposal

Two recommendation surfaces backed by one **stateless** scoring module:

- **`/recommendations/pantry`** — cook from what you have, or what you have
  marked to use up.
- **`/recommendations/discover`** — recipes to try, ranked by preference.

Convex owns all user state (preferences, an interaction event log, the pantry)
and passes it in the request body. recipe-service owns the corpus and a pure
scoring function.

Designed in [`2026-08-03-recommendations-design.md`](../superpowers/specs/2026-08-03-recommendations-design.md).
Delivered in two increments: (1) preferences + pantry intent, (2) discovery +
learned affinities.

### Amendment (2026-08-03): module, not a separate service — for now

This item originally listed "bolt recommendations onto recipe-service" as a
rejected alternative, on the grounds that it couples a heavy, evolving concern to
the canonical store. **The design deliberately does the thing this item rejected,
and the reasoning is recorded here so the item does not contradict the code.**

The coupling BL-0005 warns about is coupling of *data*, and the ranker holds no
user data to couple — Convex passes the full user context per request, so
recipe-service reads only the recipe corpus it already owns. Meanwhile a separate
service would have to reach that corpus somehow, and every option is worse than a
SQL join: HTTP-fetch every recipe per request, share the Postgres database
(strictly worse coupling than a module), or maintain a synced denormalized index
(a distributed-systems problem for a feature with no users yet).

`internal/recommend` keeps its own package boundary, its own HTTP endpoints, and
no shared state, so extraction remains a refactor rather than a rewrite. **The
trigger for extracting it is the ranker acquiring genuine derived storage** —
learned models, embeddings, or a persisted interaction index — which is exactly
the "own storage" this item anticipated. Until then, the separate service costs a
container, a deploy target, a secret, and a CI job for no isolation benefit.

## Alternatives considered

- ~~Bolt recommendations onto recipe-service — couples a heavy, evolving concern
  to the canonical store; keep separate per the multi-service intent.~~
  **Superseded** by the amendment above: adopted, because the module is
  stateless and there is no user data to couple.
- A separate `apps/recommender` service — the original intent. Deferred, not
  discarded; see the amendment for the trigger that revives it.
- Scoring in Convex TypeScript — the corpus is not local and Convex queries
  cannot do network I/O, so it would be a non-reactive action pulling the whole
  corpus over HTTP per call. Wrong shape for a corpus scan.
- Pantry-driven suggestions ("cook from what's on hand") — originally listed as
  a separate feature gated on a pantry subsystem. That subsystem now exists
  (BL-0021, done), so it is **in scope** as the `/recommendations/pantry`
  endpoint.
