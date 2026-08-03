---
id: BL-0051
title: Seed the recipe catalog in the e2e environment
status: proposed
area: infra
effort: S
related_specs: [2026-07-12-seeded-recipe-catalog-design.md, 2026-08-03-recommendations-design.md]
created: 2026-08-03
---

## Context

`scripts/e2e.sh` stands up Postgres, Convex and recipe-service, but never runs
`cmd/seed`. So the `catalog` rows exist in every other environment and in no e2e
run: `ListRecipes(ctx, CatalogUserID)` comes back empty for the whole suite.

This was found the hard way. BL-0005's recommendations spec asserted that a
catalog recipe surfaces once the user's own recipe is excluded (it lands in the
basket, and a basketed recipe is filtered from its own results). The reasoning
was right for production and impossible in e2e, so the test failed on its first
CI run with an empty result set. It was rewritten to build its own candidate.

The bug was in the test, but the gap it exposed is real: **every catalog-backed
path is invisible to the browser suite.** `GET /catalog`, the
`/recipes/catalog` route, add-catalog-recipe-to-basket, and catalog recipes as
recommendation candidates are all exercised only by Go and unit tests, which
means an integration-level break in any of them reaches main green.

## Proposal

- Run `go run ./cmd/seed` from `scripts/e2e.sh` after migrations and before
  Playwright starts, with `DATABASE_URL` pointed at the compose Postgres.
- Add a spec that browses `/recipes/catalog` and adds a catalog recipe to the
  basket — the path most likely to break silently, since catalog recipes are
  owned by the `CatalogUserID` sentinel rather than the caller.
- Once seeded, the BL-0005 use-up spec can drop its hand-built candidate and
  assert the real production shape (suggestion sourced from the catalog).

Note that seeding changes the starting state for every spec: `/recipes` and any
count-based assertion will see catalog rows that were not there before. The
existing specs are all scoped to per-run unique titles, so this should be inert,
but it wants a full suite run to confirm rather than an assumption.

## Alternatives considered

- **Leave e2e catalog-free and keep tests self-contained** — what BL-0005 does.
  Cheap and honest, but it permanently excludes a shipped feature from
  end-to-end coverage, and the next author will re-derive the same wrong
  assumption from reading production code.
- **Seed a smaller e2e-only catalog fixture** — avoids coupling specs to the
  real dataset's contents, but then the suite no longer exercises the actual
  `catalog.json` that ships, which is the thing worth testing.
