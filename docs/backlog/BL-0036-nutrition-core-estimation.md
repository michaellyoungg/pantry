---
id: BL-0036
title: Nutrition core — USDA FDC provider, gram resolution, per-recipe estimation
status: done
area: nutrition
effort: L
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

The foundation of the nutrition line: turn a recipe's ingredient lines into an
estimated nutrient vector, with an honest account of what could not be resolved.
Everything else in the nutrition backlog (BL-0037 through BL-0040) consumes this
and adds no new food knowledge.

Two gaps have to close for this to work at all. Ingredients are not in grams —
`"2 cloves garlic"`, `"1 cup flour"` — and the existing `Normalizer` converts
only *within* a dimension, so it cannot cross from volume or count to mass.
USDA FoodData Central's `foodPortions` supplies exactly the missing gram weights
per household measure.

Depends on **BL-0035** for per-serving output (whole-recipe totals work without
it).

## Proposal

New Go package `apps/recipe-service/internal/nutrition`, three testable pieces:

- **`Provider`** — `Lookup(ctx, canonicalItem) (Food, error)`. FDC
  implementation searches, picks a best match, and persists it. A **fake
  provider** backed by fixtures serves the whole unit suite, so no test and no
  offline development needs an API key.
- **`Resolver`** — ingredient line → grams. Mass via the existing
  `Normalizer.Unit()`; volume and count via cached `foodPortions` gram weights.
  Unresolvable lines return a reason that reaches the UI.
- **`Compute`** — pure: `(recipe, servings, resolved lines) → NutritionEstimate`.

Four Postgres tables — `nutrients`, `ingredient_food_map`, `food_nutrients`,
`food_portions` — keyed on the `canonical_item` the `Normalizer` already
produces, so nutrition, aisles, and future pricing join on one identifier.
`ingredient_food_map` carries `match_confidence` and a `reviewed` flag: it is the
**cache and the override point**, so a wrong fuzzy match is fixed by editing one
row.

Endpoint `GET /recipes/{id}/nutrition` behind the existing service-secret
middleware, returning totals, per-serving, **coverage** (resolved mass fraction
plus counts), and per-ingredient provenance. Web surfaces the per-serving
estimate on the recipe, labeled *estimated*, suppressing the figure and naming
the missing ingredients below a coverage threshold.

Two shape decisions the design fixes and this item must honor: nutrients are an
open `nutrientId → amount` map (never a typed macro struct), and nutrient ids are
**FDC nutrient numbers** (1008 energy, 1003 protein, 1253 cholesterol, …) rather
than a parallel taxonomy. Both exist so later nutrients cost no code.

Data is CC0 public domain, so caching is unrestricted and permanent; steady-state
FDC traffic approaches zero. The 1,000 req/hr limit degrades to "unresolved",
never to an error.

## Alternatives considered

- **A curated local USDA subset** instead of the live API — deterministic and
  offline, but coverage is capped by curation effort, and gaps degrade the goal
  tracking that motivates the whole line. The reviewable mapping table recovers
  most of the confidence benefit without the ceiling.
- **Edamam / Nutritionix** — best-in-class natural-language parsing would
  sidestep the gram problem entirely, but $299–$1,850/mo and caching
  restrictions conflict with storing snapshots. **Spoonacular** was already
  rejected on its 1-hour cache limit in BL-0023.
- **Storing the estimate on the recipe row** — faster reads, but stale on every
  recipe edit or mapping correction. Computing on read avoids the invalidation
  problem entirely.
- **Blocking on BL-0031** (normalization dictionary coverage). Better coverage
  helps, but unknown items still pass through to FDC search, so this ships
  useful without it and improves as the dictionary grows.

## Delivered

`internal/nutrition` (Provider / Resolver / Compute), the four Postgres tables,
`GET /recipes/{id}/nutrition`, and an estimated-nutrition panel on the recipe
list that suppresses the figures below 80% mass coverage and names what it could
not account for. Per-serving figures are wired through **BL-0035**'s nullable
`Recipe.servings`; a recipe without a yield shows whole-recipe totals and omits
`perServing` rather than dividing by a guess.

Two notes for whoever picks up BL-0037+:

- **The FDC key is optional and currently unset.** Without `FDC_API_KEY` the
  service serves `internal/nutrition/snapshot.json`, a hand-assembled seed of
  ~21 common ingredients with synthetic negative `fdcId`s so they cannot
  masquerade as real FDC records. `CachingProvider.Refresh` upgrades a seeded
  row to live FDC data once a key is configured, and never overwrites a row a
  human has marked `reviewed`. Coverage on anything outside the seed is 0 until
  a key exists — which the coverage report states plainly rather than hiding.
- **`POST /nutrition/estimate` was left to BL-0037.** The design lists it under
  the plan rollup, and it reuses `ScaledRecipe` and the planner's existing
  `servingsMultiplier`, so it belongs with that item rather than here.
