# Nutrition system — recipe estimation, goals, and habit review

**Status:** approved · **Backlog items:** [BL-0035](../../backlog/BL-0035-recipe-yield-servings.md),
[BL-0036](../../backlog/BL-0036-nutrition-core-estimation.md),
[BL-0037](../../backlog/BL-0037-nutrition-plan-rollup.md),
[BL-0038](../../backlog/BL-0038-nutrition-targets-goals.md),
[BL-0039](../../backlog/BL-0039-nutrition-habit-review.md),
[BL-0040](../../backlog/BL-0040-nutrition-aware-recommendations.md)
· **Related:** [full-app UX plan](2026-07-12-full-app-ux-plan.md),
[ingredient normalization](2026-07-12-ingredient-normalization-design.md)

## Goal

Estimate the nutrition of a recipe, then let that estimate serve many different
questions without re-architecting for each one:

- *Am I hitting my macro goal this week?*
- *Does this recipe fit a low-cholesterol diet?*
- *How have I actually been eating — calories, carbs, protein?*
- Later: *suggest meals that fit what's left of today's budget.*

The design brief was explicitly **expandability**. The bulk of this document is
therefore about the seams, not the arithmetic. The arithmetic is easy; the
schema decisions are what decide whether question five costs a day or a quarter.

## Constraints

- **`Recipe` has no yield.** `Recipe{ID, UserID, Title, Ingredients, CreatedAt}` —
  there is no servings count, so *per-serving* nutrition is impossible today.
  This is a hard prerequisite (BL-0035), not a nice-to-have.
- **Ingredients are not in grams.** `Ingredient{Quantity, Unit, Item}` carries
  `"2 cloves garlic"` and `"1 cup flour"`. The existing `Normalizer` converts
  within a dimension (mass→g, volume→ml) but cannot cross from volume or count
  to mass — that needs per-food gram weights.
- **The canonical dictionary is a stub.** `normalization.json` currently holds
  5 items and 3 synonyms. Nutrition coverage is bounded by it. BL-0031
  (proposed) expands it; this design must degrade gracefully until it lands,
  not block on it.
- **Convex queries and mutations cannot do network I/O.** Only actions can. Any
  call to an external nutrition source must originate in Go or a Convex action.
- **The service split is already declared.** recipe-service (Go + Postgres) is
  the canonical source of truth for recipe and ingredient data; Convex holds
  user-centric reactive data and stores recipe *ids* only, never recipe bodies.
  Nutrition data is food knowledge, not user data.

## Non-goals

- **Cooked-dish accuracy.** We estimate the sum of as-purchased ingredients.
  Water loss, drained fat, discarded trim, and "salt to taste" are not modeled.
  This is the standard approximation for recipe apps, and it is why every number
  the UI shows is labeled *estimated*.
- **Medical or clinical use.** Targets are a personal-tracking convenience.
- **Micronutrient completeness.** The model supports any nutrient FDC returns,
  but the first UI surfaces energy and macros plus the few nutrients the stated
  scenarios need (cholesterol, sodium, fiber, saturated fat).
- **Manual food logging outside the plan.** History is derived from planned and
  cooked recipes. A general "log anything you ate" food diary is out of scope.

## Data source

**USDA FoodData Central**, live API with an indefinite local cache.

- Free; requires an `api.data.gov` key; rate-limited to **1,000 requests/hour**.
- Data is **CC0 1.0 public domain**, so caching results indefinitely is
  unrestricted — the constraint that disqualified Spoonacular for pricing
  (BL-0023) does not apply here.
- `foodPortions` supplies **gram weights per household measure** (`1 cup`,
  `1 clove`, `1 large`), which is exactly the volume→mass and count→mass data
  the second constraint above requires.
- Nutrient identity comes from **FDC nutrient numbers** (1008 energy kcal, 1003
  protein, 1004 total fat, 1005 carbohydrate, 1253 cholesterol, 1093 sodium,
  1079 fiber, 1258 saturated fat). We do not invent a parallel taxonomy.

Rejected: **Edamam / Nutritionix** ($299–$1,850/mo, and caching restrictions
conflict with storing snapshots), **Spoonacular** (1-hour cache limit, already
rejected in BL-0023 for the same reason).

The two real costs of the live-API choice, and how this design contains them:

| Cost | Mitigation |
|---|---|
| A new secret in dev, CI, and prod | `Provider` is an interface with a fake implementation; the whole unit suite and offline development run without a key. A missing key degrades to "unknown", never to an error. |
| Fuzzy matching over 2M+ foods is error-prone | The cache **is** a reviewable mapping table. `ingredient_food_map` stores one row per canonical ingredient with a `reviewed` flag, so a wrong automatic match is corrected by editing one row rather than by tuning a matcher. |

## The four decisions that make this expandable

Everything below follows from these. They are listed first because they are the
part of the design that is expensive to change later.

### 1. The nutrient vector is the interface — never a struct

Nutrition is carried as an open map of `nutrientId → amount`, never as
`{calories, protein, carbs, fat}`. Adding cholesterol, potassium, or added
sugars is then a **data** change: no migration, no wire-type change, no
redeployment of consumers. The low-cholesterol scenario costs nothing extra on
the day it is asked for, because cholesterol was never a special case.

The temptation to add a typed struct "for convenience" should be resisted at
every layer. Convenience accessors may exist in the UI; the storage and
transport shape stays open.

### 2. Diet goals are declarative constraints, not features

"Hit 150g of protein", "keep cholesterol under 200mg", "low carb", and "stay
under 2,000 calories" are one shape:

```
{ nutrientId, operator, value, period }
```

One evaluation function serves all of them — and serves goals nobody has
thought of yet. A **diet preset** ("low cholesterol", "high protein") is a
bundle of these rows, so presets are data and ship without a deploy. There is
no `lowCarbMode` boolean anywhere in the system.

### 3. Coverage and confidence are first-class, never optional

Every estimate reports what fraction of the recipe's mass actually resolved,
plus a per-ingredient breakdown naming what could not be accounted for. A
nutrition feature that silently reports 40% of a recipe as though it were 100%
is worse than one that admits it does not know — and with goal tracking in
scope, a confidently wrong number corrupts the headline feature rather than
merely disappointing in it.

The UI contract: below a coverage threshold, show the estimate as a range or
suppress the number and name the missing ingredients. Never a bare figure.

### 4. Nutrition emits; it never subscribes

The nutrition module knows about recipes and ingredients. It knows nothing
about the planner, the recommender, pricing, or the pantry. Consumers pull the
vector and the evaluator. This is what lets "suggest recipes that fit my
remaining macros today" (BL-0040) arrive later as a scoring input to BL-0005
rather than as a rewrite of anything.

## Architecture

Nutrition lives as a **module inside recipe-service**, with user-centric
evaluation in Convex.

```
recipe-service (Go + Postgres)          Convex                     web
─────────────────────────────────       ──────────────────         ──────────
internal/nutrition
  Provider   (FDC client | fake)        nutritionTargets           goal editor
  Resolver   (line → grams)             nutritionLog               plan rollup
  Compute    (pure: → estimate)         evaluate(targets, vec)     habit review
  ↑ reuses internal/recipe.Normalizer   (action → recipe-service)
GET  /recipes/{id}/nutrition
POST /nutrition/estimate
```

**Why a module and not a service.** It matches the declared split (Go owns
canonical food knowledge, Convex owns user-centric reactive data), and it reuses
the `Normalizer`'s unit machinery in-process rather than duplicating or
extracting it. The internal boundary — `Provider`, `Resolver`, `Compute`, and
its own tables — is drawn so extraction into a standalone `nutrition-service` is
a lift-and-shift if it ever earns one. This is the same reasoning BL-0023
applies to pricing.

**Why not entirely in Convex.** Convex queries and mutations cannot make network
calls, the unit-conversion and canonicalization logic lives in Go, and putting
food knowledge in the user-data store contradicts the architecture the repo has
already committed to.

### Postgres tables

| Table | Columns | Notes |
|---|---|---|
| `nutrients` | `id` (FDC number), `name`, `unit` | Reference data, seeded, ~20 rows for the nutrients we surface. |
| `ingredient_food_map` | `canonical_item` (PK), `fdc_id`, `fdc_description`, `match_confidence`, `reviewed`, `matched_at` | One row per canonical ingredient. The review/override point for fuzzy matching. |
| `food_nutrients` | `fdc_id`, `nutrient_id`, `amount_per_100g` | Cached FDC nutrient data. |
| `food_portions` | `fdc_id`, `portion_key`, `gram_weight` | `portion_key` is a normalized measure (`cup`, `tbsp`, `clove`, `each`). Powers volume→mass and count→mass. |

`canonical_item` is the key produced by the existing
`Normalizer.CanonicalItem()`, so nutrition, aisles, and (later) pricing all join
on the same identifier.

### Go package `internal/nutrition`

Three pieces, each independently testable:

- **`Provider`** — `Lookup(ctx, canonicalItem) (Food, error)`. The FDC
  implementation searches, picks a best match, persists it to
  `ingredient_food_map` + `food_nutrients` + `food_portions`, and returns it.
  A **fake provider** backed by fixtures serves the entire unit suite, so no
  test and no offline development needs a network key.
- **`Resolver`** — `Grams(ingredient, food) (grams float64, ok bool, reason string)`.
  Mass units convert via the existing `Normalizer.Unit()`. Volume units convert
  to a base volume, then to grams via `food_portions`. Countable units
  (`clove`, `""`) look up a per-piece gram weight. Anything unresolvable returns
  `ok == false` with a reason that reaches the UI.
- **`Compute`** — pure. `(recipe, servings, resolved lines) → NutritionEstimate`.
  No I/O, so the interesting logic is trivially testable.

### Wire type

Shared between Go and `packages/types`:

```ts
interface NutrientAmount { nutrientId: string; amount: number; unit: string }

interface NutritionEstimate {
  nutrients:  Record<string, NutrientAmount>;   // whole recipe / whole selection
  perServing: Record<string, NutrientAmount>;
  servings: number;
  coverage: {
    resolvedMassFraction: number;               // 0..1
    resolvedCount: number;
    totalCount: number;
  };
  ingredients: Array<{
    item: string;
    grams: number | null;
    resolved: boolean;
    reason?: string;                            // "no gram weight for unit 'pinch'"
  }>;
  estimatedAt: string;                          // ISO-8601
}
```

### HTTP

- `GET /recipes/{id}/nutrition` → `NutritionEstimate` for one recipe.
- `POST /nutrition/estimate` → body `{items: [{recipeId, multiplier}]}`, the same
  shape the grocery-list aggregation already accepts, returning a combined
  `NutritionEstimate`. This *is* the plan rollup — it reuses `ScaledRecipe` and
  the planner's existing `servingsMultiplier` rather than inventing a parallel
  path.

Both sit behind the existing `X-Service-Secret` / `X-User-Id` middleware.

### Convex tables

```ts
nutritionTargets: defineTable({
  userId: v.string(),
  nutrientId: v.string(),
  operator: v.union(v.literal("<="), v.literal(">="), v.literal("==")),
  value: v.number(),
  period: v.union(v.literal("day"), v.literal("week"), v.literal("meal")),
  label: v.optional(v.string()),
  active: v.boolean(),
}).index("by_user", ["userId"])

nutritionLog: defineTable({
  userId: v.string(),
  date: v.string(),                    // YYYY-MM-DD
  recipeId: v.string(),
  servings: v.number(),
  source: v.union(v.literal("planned"), v.literal("cooked"), v.literal("manual")),
  snapshot: v.any(),                   // nutrientId -> amount, denormalized
}).index("by_user_date", ["userId", "date"])
```

`snapshot` denormalizes the vector at log time deliberately. FDC data is
refreshed and mappings get corrected; without a snapshot, a fix applied today
would silently rewrite what the user ate last month. History must be stable.

### Evaluation

A pure function, `(targets, summedVector) → [{target, actual, status}]` where
`status ∈ {met, under, over, unknown}`. `unknown` propagates from low coverage
rather than being reported as zero.

It depends on nothing but its arguments, which makes it the natural first tenant
for `packages/core` (BL-0024) so web and any future client share one
implementation. Until that package exists it lives in the web app as a pure
module with its own unit tests.

## Data flow

**Per recipe.** Web → Convex action → `GET /recipes/{id}/nutrition` →
recipe-service resolves each ingredient line to grams (cache hit, or FDC lookup
then cached) → `Compute` → estimate returned with coverage.

**Per plan.** Web → Convex action → `POST /nutrition/estimate` with the week's
basket entries and their `servingsMultiplier` values → one combined estimate per
day and for the week → evaluated against `nutritionTargets`.

**Habit review.** `nutritionLog` rows accumulate from the plan. Today the only
available signal is *planned* — nothing records what was actually cooked. When
BL-0028 (cook-decrement) introduces "mark cooked", the same row upgrades from
`source: "planned"` to `source: "cooked"`. The review surface reports which it
is showing, so the feature is useful before BL-0028 and more accurate after it.

## Edge cases

- **No FDC key configured** — every lookup returns unresolved, coverage is 0,
  the UI shows "nutrition unavailable". Never an error, never a partial number
  presented as complete.
- **Ingredient not in the canonical dictionary** — `CanonicalItem` passes the
  raw text through, so the FDC search still runs against it; a poor match is
  caught by `match_confidence` and the `reviewed` flag.
- **Unresolvable unit** (`pinch`, `to taste`, `""` on a non-countable item) —
  line is unresolved with a reason. These are frequently negligible (salt,
  spices), so the coverage *mass* fraction matters more than the count.
- **`servings` missing or zero** — totals are still returned; `perServing` is
  omitted rather than divided by a guess.
- **Recipe edited after estimation** — the estimate is computed on read, not
  stored on the recipe, so it cannot go stale. Only `nutritionLog.snapshot`
  persists a vector, and that is intentional.
- **FDC rate limit reached** — lookups fall back to unresolved for the
  remainder of the window; cached ingredients are unaffected. Since the cache is
  permanent and keyed by canonical ingredient, steady-state traffic to FDC
  approaches zero.

## Testing

- **Unit (Go):** `Resolver` conversion tables (mass, volume-via-portion,
  count-via-portion, unresolvable), `Compute` totals and per-serving division,
  coverage arithmetic. All against the fake provider — no network.
- **Golden recipes:** a small fixture set of real recipes with hand-verified
  expected grams per line, guarding the conversion path against regression.
- **Integration:** the new endpoints join the existing
  `recipes.integration.test.ts` contract suite — genuine HTTP, real headers,
  real JSON shapes, catching contract drift the unit suites cannot.
- **Convex:** `convex-test` over targets CRUD and log writes.
- **Evaluation:** pure-function tests per operator and period, including the
  `unknown` propagation path.
- **FDC client:** tested against recorded fixtures, not the live API, so CI
  needs no key.

## Increments

| Item | Scope | Effort |
|---|---|---|
| BL-0035 | Recipe yield / `servings` + JSON-LD `recipeYield` extraction — **prerequisite** | S |
| BL-0036 | Nutrition core: provider, cache tables, resolver, compute, coverage, `GET /recipes/{id}/nutrition` | L |
| BL-0037 | Plan rollup: `POST /nutrition/estimate`, day/week totals on `/plan` | M |
| BL-0038 | Targets, evaluation, and diet presets | M |
| BL-0039 | Habit review: `nutritionLog` + retrospective surface | M |
| BL-0040 | Nutrition-aware recommendations — feeds BL-0005 / BL-0033 scoring | M |

The originating scenarios map onto these directly: a macro goal is BL-0038; a
low-cholesterol diet is BL-0038 with a single constraint row; reviewing eating
habits is BL-0039; and BL-0040 is the payoff for keeping nutrition emit-only.

## Alternatives considered

- **Standalone `nutrition-service`.** Cleanest boundary and independently
  replaceable, but it adds a deploy target and secret plumbing, and it either
  duplicates the `Normalizer` or forces extracting it to a shared package first.
  Module-first with a clean internal seam gets the same decoupling at a fraction
  of the cost, and the extraction stays available.
- **Nutrition entirely in Convex.** Fewest moving parts on paper, but Convex
  queries and mutations cannot make network calls, the conversion logic lives in
  Go, and it would place food knowledge in the user-data store against the
  stated architecture.
- **A curated local USDA subset instead of the live API.** Deterministic,
  offline, and higher-confidence per ingredient, but coverage is capped by
  curation effort — and with goal tracking as the headline, gaps degrade the
  feature that matters most. The reviewable mapping table recovers most of the
  confidence benefit without the coverage ceiling.
- **A typed macro struct** (`{calories, protein, carbs, fat}`). Simpler to read
  and to render, and it is what most recipe apps ship. Rejected because every
  subsequent nutrient — starting with the cholesterol scenario in the original
  brief — would cost a migration and a wire-type change across three languages.
- **Storing the estimate on the recipe row.** Faster reads, but it goes stale
  whenever a recipe is edited or a mapping is corrected, and it invites the
  cache-invalidation problem that computing on read simply does not have.
