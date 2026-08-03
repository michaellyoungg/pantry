---
id: BL-0035
title: Recipe yield — servings on the recipe model + import extraction
status: proposed
area: recipes
effort: S
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

`Recipe{ID, UserID, Title, Ingredients, CreatedAt}` has no yield. The planner's
`servingsMultiplier` (BL-0018 increment 2) is a *scale factor* — "cook 1.5× this
recipe" — not an absolute serving count, so nothing in the system knows how many
people a recipe feeds.

Every per-serving figure depends on this: nutrition per serving
(BL-0036/BL-0037), per-serving cost (BL-0023), and "does this feed my
household?" in the planner. The nutrition design (2026-08-03) names it a hard
prerequisite — without it, only whole-recipe totals are computable, which is not
what a macro goal needs.

Import can already supply it: JSON-LD `recipeYield` is present on most recipe
sites and the parser (BL-0001) already walks the JSON-LD graph, it just drops
the field.

## Proposal

- Add `servings` (nullable integer) to the `Recipe` struct, the Postgres schema,
  and `packages/types`. Nullable, so existing recipes and manual entry without a
  yield keep working.
- Extract `recipeYield` during JSON-LD import, handling the common shapes
  (`"4"`, `"4 servings"`, `["4"]`, `{"@type":"QuantitativeValue","value":4}`).
  Ignore range forms (`"4-6"`) by taking the lower bound.
- Surface it as an editable field on the recipe review screen (BL-0020 funnel)
  and on manual recipe creation.
- Consumers treat absent `servings` as "unknown" and omit per-serving figures
  rather than guessing.

## Alternatives considered

- **Infer servings from ingredient mass.** Attractive because it needs no schema
  change, but total mass varies enormously by dish type and the error would be
  invisible to the user. Rejected.
- **Fold this into BL-0030** (recipe discovery metadata: cuisine, tags, cook
  time, source URL). Same table, same import path, so bundling is defensible.
  Kept separate because BL-0030 serves discovery filters and this blocks the
  whole nutrition line — they should be schedulable independently. Whichever
  lands second should reuse the other's migration rather than adding a new one.
- **Reuse `servingsMultiplier`.** It answers a different question (how much to
  cook, per plan entry) and lives in Convex on the basket, not on the recipe.
