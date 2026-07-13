---
id: BL-0020
title: Recipe "Add" funnel (one review screen) + catalog search & filters
status: in-progress
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

## Progress

Shipping in increments (this item is effort **M**).

- **Increment 1 (done):**
  - **One editable review surface.** Extracted a shared `RecipeFields` component
    (title + ingredient rows + add-row) now used by manual create, URL-import
    review, and the edit dialog — delivering "the import review screen and the
    edit dialog should be one component." `emptyIngredient`/`cleanIngredients`
    are shared helpers; the two paths no longer duplicate the editor.
  - **Catalog search box** — client-side filter over title + ingredient names,
    with a distinct no-match state. (The spec accepts client-side while the seed
    catalog is small.)
  - Frontend-only; no schema, recipe-service, or basket change.
- **Deferred to later increments:**
  - **Filter chips** (cook time / diet / cuisine). Need recipe schema fields
    (`totalMinutes`, `cuisine`, `tags[]`) that don't exist yet — Go `Recipe` +
    `catalog.json` + `@pantry/types` + Convex validators. Overlaps BL-0002
    (seeded catalog); coordinate before adding.
  - **Clone-on-add** for catalog recipes (user edits don't mutate the shared
    catalog) — touches basket/recipe-create semantics; coordinate with BL-0018.
  - **`sourceUrl`** field on `Recipe` (attribution + re-import) — schema change.
  - **URL parsing** itself is BL-0001 (already done); **photo import** is later.

## Alternatives considered

- **Keep separate add paths** — more surface area, inconsistent editing, and no single place
  to review imports.
- **Client-side catalog filtering only** — fine while the seed catalog is small; revisit if
  the catalog grows.
