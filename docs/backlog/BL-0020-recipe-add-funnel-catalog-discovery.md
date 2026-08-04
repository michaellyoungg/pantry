---
id: BL-0020
title: Recipe "Add" funnel (one review screen) + catalog search & filters
status: done
area: recipes
effort: M
related_specs: [2026-07-12-full-app-ux-plan.md, 2026-07-12-seeded-recipe-catalog-design.md]
created: 2026-07-12
---

## Context

Getting recipes in is fragmented (separate `RecipeForm`, `Catalog`, and the proposed
URL-import BL-0001), and the catalog is a bare list with no search/filter. The
recipe-service already produces structured `{quantity, unit, item, note}` ingredients with
normalization — so imports need zero special downstream handling.

## Proposal

- **One "Add Recipe" funnel, four entry points → one review-and-edit screen** (URL · manual
  · catalog · photo-later). **Never save a parse silently;** the review screen is the
  editable confluence. The import review screen and the edit dialog should be **one
  component**.
- **Catalog discovery:** search box + filter chips for **cook time** (#1 weeknight filter),
  diet, cuisine. Requires light schema additions (`cuisine`, `totalMinutes`, `tags[]`) — see
  decision #4 in the UX plan.
- **Clone-on-add** for catalog recipes (user edits don't mutate the shared catalog).
- URL parsing itself is **BL-0001** (scope it to schema.org/Recipe JSON-LD + a paste-text
  fallback — much cheaper than its "L" estimate given the existing ingredient model).
- Add a `sourceUrl` field to `Recipe` for attribution + re-import.

## Alternatives considered

- **Keep separate add paths** — more surface area, inconsistent editing, and no single place
  to review imports.
- **Client-side catalog filtering only** — fine while the seed catalog is small; revisit if
  the catalog grows.

## Progress

**Increment 1 — one review surface + catalog search.** `RecipeFields` is the single
review-and-edit component behind manual entry, URL-import review and the edit dialog.

Increment 1 was written once before and **never reached `main`**: PR #41 squash-landed only
the claim despite its title, and the implementation commit (`83c50b6`) was pushed to
`worktree-myoung-recipe-funnel-catalog` *after* the squash-merge, stranding it. It was
re-applied on current `main` rather than cherry-picked, because it predated servings
(BL-0035), steps (BL-0022) and equipment (BL-0041).

**Increment 2 — discovery metadata, filter chips, clone-on-add.**

- `cuisine`, `totalMinutes`, `tags[]`, `sourceUrl` on the recipe model, plumbed Go →
  `packages/types` → Convex → UI. `cuisine`/`tags` are an **open** vocabulary (nothing keys
  on them, unlike the closed method enum BL-0042 depends on); recipe-service slugifies both
  so `Gluten Free`, `gluten_free` and `GLUTEN-FREE` are one chip. `totalMinutes` is nullable
  — for a duration, unknown and zero are different answers.
- Filter chips for cook time (lead), diet and cuisine. **A recipe with no stated cook time
  matches no time bucket** — rounding unknown into "fast" would make the weeknight filter
  lie. Chips are derived from the loaded catalog, so one is never offered that matches
  nothing. Diet is a UI grouping of known tags, not a schema constraint; an unrecognized tag
  stays searchable.
- Clone-on-add (`POST /catalog/{id}/add` → `recipes.addFromCatalog`). The source read is
  scoped to `CatalogUserID`, never the caller — catalog rows belong to a sentinel user, and
  a caller-scoped lookup silently misses all of them. Idempotent via a server-owned
  `sourceRecipeId` (a partial unique index backstops it), so the add button cannot quietly
  produce two copies. The **clone** is basketed, not the catalog id, which is what makes a
  planned catalog recipe editable at all.
- JSON-LD import now reads `recipeCuisine`, `totalTime` (falling back to
  `prepTime`+`cookTime`) and `recipeCategory`+`keywords`, and records the source URL. This
  absorbs the never-filed **BL-0030** (recipe discovery metadata), referenced by BL-0035 and
  BL-0041; BL-0041's import split is honoured — it owns `cookingMethod`, this owns
  `recipeCategory`/`keywords`.
- `Store.Create/UpdateRecipe` now take a `RecipeInput` struct (they were at eight positional
  arguments and would have reached twelve).

Verified: full Go suite under `-race`, 26 Postgres integration tests against a real
Postgres, 19 cross-service contract tests against a real recipe-service binary, plus web
(308), core (219) and Convex (148) unit tests, typecheck, knip and coverage thresholds.

Not in scope and still open: photo import (the funnel's fourth entry point, explicitly
deferred by the proposal) and server-side catalog search, which stays client-side while the
seed catalog is six recipes.
