---
id: BL-0005
title: Recommendations / preference-lookup service
status: done
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

## Increment status

**Increment 1 — delivered.** `preferences` schema + `/settings` screen, avoid-list
hard filter, `POST /recommendations/pantry`, the `useItUp` flag, and the
"cook from what you have" surface.

Two implementation notes worth recording, because both differ from the design doc:

- **`internal/recommend` is dependency-free; the HTTP handler and candidate
  assembly live in `internal/recipe`.** The design put both inside
  `internal/recommend`, which does not build: assembly needs `recipe.Store` and
  the unexported `normalizer`, while the route registers on `recipe`'s mux — an
  import cycle. Moving the boundary one notch left `recommend` with *zero*
  imports, which is a stronger isolation than the design described.
- **Exactly two scoring features are live**: `useItUpHits` and `coverage`.
  `affinity` (needs the event log, increment 2), `missingNonStaple` (needs a
  `staple` flag, BL-0031) and `recentlyPlanned` (needs plan history) are wired
  and report unavailable, contributing to neither the numerator nor the
  denominator of the score.

**e2e:** the Playwright spec (`apps/web/e2e/recommendations.spec.ts`) could not be
run locally — a git worktree gets its own docker compose project, so `e2e.sh`
stands up a second stack that collides on port 8090 with the shared one — so CI
was its first real run, and it failed. The use-up test assumed the suggestion
would come from the seeded catalog, but `scripts/e2e.sh` never runs `cmd/seed`,
so the catalog is empty for the whole suite and the assertion could never have
passed. Both specs now build their own candidate recipe; the underlying coverage
gap is [BL-0051](BL-0051-e2e-seeds-the-catalog.md).

**Increment 2 — delivered.** `POST /recommendations/discover`, the
`recommendationEvents` log, derived ingredient affinities, and the "For you"
card on `/recipes`.

Four notes worth recording:

- **The module boundary held.** `internal/recommend` still imports NOTHING. The
  ranker never sees an event: Convex folds a recent window of them into an
  ingredient→weight map and sends *that* in the request body, so the learned
  half of the recommender arrived without giving the ranker any state at all.
  Handler and candidate assembly stayed in `internal/recipe`.
- **Affinities are derived at request time, never stored as a score.** A
  per-user per-ingredient table would be a second source of truth about the same
  events with no way to tell which had gone stale. This also means the amendment
  above still holds: the ranker has acquired no derived storage, so the trigger
  for extracting it into its own service has not fired.
- **Cold start is the rule the whole feature turns on**, and it is now asserted
  on both sides of the wire: `lib/affinity.ts` returns an empty map for a user
  with no history, and `recommend.affinityView` reports UNAVAILABLE for an empty
  map rather than scoring every candidate zero. Discovery weights affinity most
  heavily of all features, so getting this wrong would have punished precisely
  the users who have not used the product yet.
- **`shown` events are recorded after all**, which the design doc argued against.
  They earn their rows by feeding `novelty` — with a six-recipe catalog, "you
  have seen this six times" is what stops the surface showing the same card
  forever — and they are deduplicated per recipe per day on write, so they cannot
  bury the intentional rows. They carry ZERO affinity weight: an impression is
  not an opinion.

Two discover-only scoring features arrived alongside the ones the design listed:
`novelty` (from impressions) and `nearDuplicate` (threshold-gated Jaccard against
the user's own recipes, gated because BL-0033 learned that an ungated similarity
penalty fires on every pair and cancels the signals beside it).

Still unavailable and still wired: `recentlyPlanned` (needs plan history; the
basket is current-week only) and `costFit` (BL-0023).
