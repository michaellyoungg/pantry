# Recommendations — cook-from-what-you-have + preference-based discovery

- **Backlog item:** [BL-0005](../../backlog/BL-0005-recommendations-service.md)
- **Date:** 2026-08-03
- **Status:** approved, ready for implementation planning

## Summary

Two recommendation surfaces, backed by one stateless scoring module inside
recipe-service:

- **`/recommendations/pantry`** — "what can I make with what I have (or want to
  use up)?"
- **`/recommendations/discover`** — "what should I try, given my taste?"

Convex keeps owning all user state (preferences, an interaction event log, the
pantry) and passes it to the ranker in the request body. recipe-service holds the
recipe corpus and a pure scoring function, and stores no user data it does not
already store.

The design deliberately builds the *seam* for features whose data does not exist
yet — expiry urgency (BL-0029), cost/sale fit (BL-0023), cuisine and cook-time
facets — and lets them contribute nothing until their backing item ships. See
[Graceful degradation](#graceful-degradation) for the mechanism that makes this
safe rather than merely absent.

Delivered in **two increments**; see [Increments](#increments).

## Context

The core loop (plan → list → shop → cook) is built. Recommendations are the
first feature that *reads* the accumulated state rather than adding to it, and
the state it wants to read is the thinnest part of the codebase.

### What exists

- **Pantry** (BL-0021, done). `pantryItems` keyed on `canonicalItem` with a
  coarse `have | low | out` state and `source: auto | manual`. Rows are created
  automatically when a grocery item is checked off.
- **Ingredient normalization** (BL-0003, done). recipe-service resolves synonyms
  and emits a `canonicalItem` per grocery line. This is the join key between
  pantry rows and recipe ingredients, and it is why ingredient-level matching is
  possible at all.
- **The planner** (BL-0018). `basket` rows carry `weekday`, `slot`,
  `servingsMultiplier`, and `type: meal | leftover`.
- **Cross-service call pattern.** Convex *actions* call recipe-service over HTTP
  with `X-Service-Secret` / `X-User-Id` (see `packages/convex/convex/recipes.ts`
  and the `POST /grocery-list` aggregation). Convex *queries* cannot do network
  I/O, so anything that consults recipe-service is an action and is therefore
  fetched, not reactive.

### What does not exist

These are the constraints that shaped every decision below.

| Input a recommender wants | State today |
| --- | --- |
| Recipe metadata | **None.** `recipes` is `id, user_id, title, created_at`. No cuisine, tags, cook time, diet, or instructions. |
| Catalog corpus | **6 recipes** in `catalog.json`. BL-0002 is still `in-progress`. |
| Normalization dictionary | **5 canonical items, 3 synonyms** in `normalization.json`. |
| Pantry outflow | **None.** Nothing ever leaves the pantry — cook-decrement is BL-0028 (`proposed`). |
| Preferences | `preferences` table exists as `{ userId, data: v.any() }`. No writer, no UI. |
| Interaction history | **None.** Nothing records planned / cooked / dismissed. |

Two consequences follow, and they are load-bearing:

1. **Ingredients are the only universal recipe attribute.** Any preference model
   built on facets ("I like Thai", "under 30 minutes") has nothing to score
   against, because no recipe carries those fields. The preference model must
   therefore be ingredient-grounded first.
2. **Perceived quality is bounded by two other backlog items** — corpus size
   (BL-0002) and dictionary coverage (BL-0003 extension) — neither of which is in
   scope here. See [Risks](#risks).

### Leftover ingredients vs. leftover portions

"Leftovers" is ambiguous in this codebase and the two meanings are unrelated:

- **Leftover portions** — cooked food eaten again later. *Already modelled*, as
  `basket.type: "leftover"` (BL-0018 increment 2).
- **Leftover ingredients** — raw ingredients that outlive the recipe that bought
  them. *No mechanic exists.* This spec adds one.

Throughout this document, "leftover" means the second.

## Decisions

Recorded with their rationale because several are non-obvious, and one
contradicts what BL-0005 currently says.

1. **One conceptual ranker, with per-intent scoring.** Pantry-fit and taste-fit
   are features of a single scoring model, but the two endpoints run distinct
   ranking logic over shared plumbing (candidate assembly, the ingredient index,
   feature extraction, reason formatting). Shared plumbing is what gives
   BL-0023's sale signal one place to land instead of two.
2. **Scope: the ranker owns its scoring seam plus the preference and event
   model.** Recipe metadata, catalog growth, and pantry depth stay separate
   backlog items. Features whose source is missing degrade to neutral rather than
   blocking the work.
3. **A module in recipe-service, not a new service — because it is stateless.**
   BL-0005 as filed says the opposite: *"Bolt recommendations onto
   recipe-service — couples a heavy, evolving concern to the canonical store."*
   That concern is real, and the reason it does not apply here is that the
   ranker holds **no user state**. Convex passes the full user context per
   request; recipe-service reads only the corpus. The coupling BL-0005 warns
   about is coupling of *data*, and there is none to couple.

   The alternative costs are concrete: a separate service must reach the corpus
   somehow, and every option is worse than a SQL join — HTTP-fetch every recipe
   per request, share the Postgres database (strictly worse coupling than a
   module), or maintain a synced denormalized index (a distributed-systems
   problem for a feature with no users). The package boundary, separate
   endpoints, and absence of shared state mean extraction later is a refactor,
   not a rewrite. **When the ranker acquires genuine derived storage — learned
   models, embeddings — that is the moment extraction pays for itself.**

   BL-0005 is amended to record this rather than left contradicting the code.
4. **Separate endpoints per intent.** `/recommendations/pantry` and
   `/recommendations/discover` are distinct code paths. The intents pull in
   opposite directions — "use what you have" is convergent and favours the
   familiar; "try something new" is divergent — and forcing them through one
   ranking function would mean the same features carrying opposite weight signs.
5. **Leftovers are captured by explicit user input**, not inferred. A "things to
   use up" surface where the user marks what they have. Inferring residue from
   pack sizes was considered and deferred (see
   [Alternatives considered](#alternatives-considered)).
6. **Preferences are ingredient-grounded now, facet-capable later.** Avoid-list
   and liked/disliked ingredients score today; cuisine, diet label, and cook-time
   facets are captured and stored but inert until recipe metadata lands. Learned
   affinities accumulate from the event log on top. All three layers are the
   target; ingredient-grounding is where it starts.
7. **Rank the existing corpus; do not generate.** `discover` ranks catalog
   recipes the user has not saved plus their own recipes they have not planned
   recently. LLM-generated candidates are designed for — results carry a
   `source` field — but not built.

## Design

### Components

**recipe-service — `internal/recommend` (new package)**

Sits beside `internal/recipe`, shares its store and Postgres connection, and
registers two routes on the existing mux alongside `POST /grocery-list`:

```
POST /recommendations/pantry
POST /recommendations/discover
```

Internal layout, split so the endpoints share everything except ranking:

| File | Responsibility |
| --- | --- |
| `candidates.go` | assemble the pool (user's recipes + catalog), honour exclusions |
| `index.go` | ingredient → recipe lookup over `canonicalItem` |
| `features.go` | extract the feature vector for a (context, recipe) pair |
| `score_pantry.go` | the pantry-intent ranker |
| `score_discover.go` | the discovery-intent ranker |
| `weights.go` | named weight constants, one struct |
| `reasons.go` | turn winning features into human-readable strings |

**Convex — orchestration and all user state**

- Actions `recommendations.pantry` and `recommendations.discover` gather the
  user's pantry rows, preferences, derived affinities, and current basket, then
  POST to recipe-service with the existing service headers.
- Mutation `recommendations.recordEvent` logs `added` / `dismissed`.
- Mutations for preferences and for the `useItUp` flag.

**Web — three surfaces**

- `/pantry` — a "Use it up" section (mark items) and a "What can I make?" result
  list.
- `/recipes` — a "For You" section.
- `/settings` — a preferences form. The sitemap in the UX plan reserves this
  route; no route file exists yet, so this spec creates it.

### Data flow (pantry intent)

1. User marks items on `/pantry` → `pantryItems.useItUp = true`.
2. Web calls the `recommendations.pantry` action.
3. The action reads that user's pantry rows, preferences, and basket, and folds
   recent events into an affinity map.
4. It POSTs the assembled `UserContext` to recipe-service.
5. `internal/recommend` builds candidates, scores, and returns a ranked list with
   reasons.
6. Web renders. Adding a result to the plan fires `recordEvent`, which feeds
   future affinities.

Because step 2 is an action, results are **fetched, not reactive** — consistent
with how `Catalog.tsx` already consumes `listCatalog` via `useAction`. The web
surface refetches when pantry contents change so it does not look stale in an
otherwise-live app.

### Scoring model

#### Hard filters

Applied **before** scoring, and only over explicitly named ingredients.

The preferences screen has an **avoid list** of canonical ingredients. Any
candidate containing one is removed from the pool. It is never a weight —
allergies are the one place in this feature where being wrong has real-world
consequences, so no other signal may outscore them.

Diet *labels* get a treatment that avoids an unsafe failure mode. If selecting
"vegetarian" filtered by inferring which ingredients are meat, partial dictionary
coverage would produce **false negatives** — a beef recipe shown to someone who
declared vegetarian. Instead, **selecting a diet label pre-fills the avoid list
from a curated seed set**, which the user sees and can edit. The facet becomes
ingredient-grounded data at capture time and nothing is ever excluded invisibly.
The label itself is stored for later facet scoring.

##### Canonicalization on entry, and allergen families (BL-0052)

Increment 1 shipped this as an exact match on a canonical key against an entry
that had only been lowercased, which meant two silent failures. `scallion` never
matched anything, because the dictionary calls it `green onion`; and `peanut`
never removed peanut butter, because they are different canonical items. Both
look identical to a working filter from the outside — and for a declared allergy,
"looks like it worked" is the whole problem.

**Entries are resolved before they are stored.** `preferences.addAvoidItems` is
an *action* (a mutation cannot make the HTTP call) and resolves each entry
through `POST /normalization/avoid` — a sibling of `/normalization/lookup` that
answers one-to-one and in order, because lookup collapses duplicates and so
cannot say what any particular entry became. Resolving at write time rather than
at scoring time also keeps the stored row honest: `scallion` sitting in
`avoidItems` reads as a filter to everything else that touches the table.

The write **fails closed**, like the filter it feeds: if the dictionary cannot be
reached, nothing is stored and the user is told to retry. Removing an entry needs
no dictionary and stays a plain mutation.

**Allergen families are a small, explicit grouping** in `normalization.json` —
the common allergens (peanut, tree nut, milk, egg, fish, shellfish, wheat, soy,
sesame), not a general ontology of what food is made of. Membership is listed per
family rather than as a field per item, because items belong to more than one
(egg noodles are egg *and* wheat) and because the only useful review question —
"does this list miss a dairy product?" — cannot be asked of 300 scattered
records. `Normalizer` refuses to load a family listing an item that does not
exist, or a name two families claim: both are the same silent no-match in
different clothes.

Family names beat the identically-named item when resolving an entry, so `milk`
means dairy and `peanut` means the family. That errs toward removing too much,
which for an allergen is the survivable direction — and it is not invisible: the
resolution comes back with the members it covers, and the settings screen states
them. Which is the same rule diet seeds already follow.

**Every entry reports what it matched**, including the ones that matched nothing.
That case is stated in the UI rather than swallowed, for the reason the
unrecognized-ingredient rule below gives, and doubles as dictionary-coverage
feedback (BL-0031).

#### Graceful degradation

Both rankers share one scoring shape. Every feature reports a value *and*
whether its data source is available:

```
score = Σ(wᵢ · fᵢ) / Σ(wᵢ)     — summed over available features only
```

Normalizing by the **available** weight sum is what makes "this feature's
backing item has not shipped" a first-class state rather than a hole: an
unavailable feature does not drag scores toward zero, and results stay
comparable in a 0–1 band regardless of which features are live. This is the
mechanism that lets BL-0029 expiry and BL-0023 sale signals join later as pure
additions.

#### `/recommendations/pantry` features

| Feature | Meaning | Source | Available |
| --- | --- | --- | --- |
| `useItUpHits` | flagged use-it-up items the recipe consumes — highest weight | `pantryItems.useItUp` | yes |
| `coverage` | share of the recipe's ingredients on hand (`have`/`low`) | `pantryItems` | yes |
| `missingNonStaple` | penalty for ingredients that must be bought | needs a `staple` flag | partial |
| `affinity` | learned ingredient affinity | event log | yes, grows |
| `recentlyPlanned` | repetition penalty | `basket` | yes |
| `expiryUrgency` | use it before it goes bad | BL-0029 | no |
| `costFit` | cheap or on sale this week | BL-0023 | no |

`missingNonStaple` needs to know that missing salt or oil should not count
against a recipe the way missing chicken does. Until an explicit `staple` flag
exists on canonical items (BL-0031), the feature reports unavailable and the
penalty is simply absent.

#### `/recommendations/discover` features

`affinity` (explicit likes plus learned) dominates. `novelty` boosts recipes
never planned. `nearDuplicate` penalizes candidates whose ingredient set closely
mirrors something already saved. `pantryCoverage` carries a **small** positive
weight — pleasant if you can cook it tonight, but it must not turn discovery back
into the pantry endpoint. `cuisineMatch` and `timeFit` are wired and inert.

#### Weights

Hand-tuned named constants in one struct, **pinned by tests** so a tuning change
appears as an intentional diff. Not learned. The event log is what eventually
makes tuning empirical.

#### Determinism

Stable sort with a `recipeId` tiebreak. Identical input always yields identical
order, so tests do not flake and results do not reshuffle on refresh.

### Data model

#### Convex — `preferences` (replaces the placeholder)

```ts
preferences: defineTable({
  userId: v.string(),
  // Ingredient-grounded — active now
  avoidItems: v.array(v.string()),      // canonicalItem keys → hard filter
  likedItems: v.array(v.string()),
  dislikedItems: v.array(v.string()),
  // Facets — captured, inert until recipe metadata lands
  dietLabels: v.optional(v.array(v.string())),
  cuisines: v.optional(v.array(v.string())),
  maxMinutes: v.optional(v.number()),
  householdSize: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_user", ["userId"])
```

Dropping the existing `data: v.optional(v.any())` field is safe **only if the
table is empty**, because Convex validates existing rows against the new schema
on push and a stray row would fail the deploy. Implementation verifies emptiness
before pushing this change.

#### Convex — `recommendationEvents` (new)

```ts
recommendationEvents: defineTable({
  userId: v.string(),
  recipeId: v.string(),
  context: v.union(v.literal("pantry"), v.literal("discover")),
  action: v.union(v.literal("added"), v.literal("dismissed")),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_recipe", ["userId", "recipeId"])
```

**No `shown` impression events.** Logging every render would dominate this table
by orders of magnitude in order to support click-through analysis nobody is
doing. `added` and `dismissed` carry the signal that feeds affinities. A
`cooked` action slots in when BL-0028 lands.

#### Convex — `pantryItems` (one field)

```ts
useItUp: v.optional(v.boolean()),
```

The "things to use up" list is a **flag on the existing row, not a new table**. A
leftover *is* a pantry item — one the user wants prioritized. Reusing the row
means it already carries `canonicalItem` (so it joins to recipes for free),
`display`, and `aisle`, and it automatically participates in don't-rebuy. A
separate table would duplicate all of that and create two sources of truth about
what the user has.

Free-typed entries that do not resolve to a canonical item create a
`source: "manual"` row, exactly like today's manual pantry additions.

#### Affinities are derived, never stored

The Convex action folds recent events into an ingredient-weight map at request
time — added recipes upweight their ingredients, dismissed ones downweight, with
recency decay — and sends the **top ~50** in the payload. Nothing is persisted,
so there is no derived-state staleness problem and the ranker stays stateless. If
this becomes expensive it becomes a cached Convex table, which is a local change.

### HTTP contract

One request shape serves both endpoints; each ranker reads the fields it needs.

```
POST /recommendations/{pantry|discover}
X-Service-Secret, X-User-Id

{
  "pantry": [
    { "canonicalItem": "basil", "state": "have", "useItUp": true }
  ],
  "preferences": {
    "avoidItems": ["peanut"],
    "likedItems": ["garlic"],
    "dislikedItems": ["cilantro"]
  },
  "affinities": { "garlic": 0.8, "cilantro": -0.4 },
  "savedRecipeIds": ["r1"],
  "excludeRecipeIds": ["r2"],
  "limit": 20
}
```

```json
{
  "results": [
    {
      "recipeId": "cat-tomato-soup",
      "title": "Tomato Soup",
      "source": "catalog",
      "score": 0.82,
      "reasons": ["Uses 4 things you have", "Uses up: basil"],
      "have": ["tomato", "onion", "garlic", "basil"],
      "missing": [{ "canonicalItem": "olive oil", "display": "Olive oil" }]
    }
  ]
}
```

- `source` is `"catalog" | "user"`, with `"generated"` reserved for a future LLM
  candidate provider. This is the seam that makes decision 7 reversible without a
  contract change.
- `missing` powers "you need 2 more things" and is the natural hook for adding
  the gap straight to the grocery list.
- Every contributing feature emits its own reason string; the top two or three
  ride along, which lets the UI explain a suggestion without knowing anything
  about scoring.

Types live in `packages/types` with mirrored Go structs, matching how
`GroceryListRequest` and `GroceryLine` are already shared. BL-0007's OpenAPI
codegen would generate this pair eventually; it is `proposed` and not a blocker.

### Error handling

**Recommendations are additive and must never break the core loop.** If
`internal/recommend` is down or slow, `/pantry` and `/recipes` still work
completely; the section collapses to an inline error and the rest of the page is
untouched. The Convex action sets its own client timeout rather than inheriting
the default; recipe-service already has server-side timeouts and a body cap from
BL-0009.

**Empty is a first-class state, not an error.** With the current corpus this will
be common, and conflating it with failure would make a working feature look
broken:

- pantry, nothing scores: *"Nothing close yet — mark a few more items you have."*
- discover, thin corpus: *"Not much to suggest yet — browse the catalog or import
  a recipe."*
- no preferences set: discover runs on novelty alone, with a prompt to set
  preferences rather than a blank screen.

**Unrecognized ingredients are surfaced, not swallowed.** A free-typed use-it-up
entry that does not resolve to a `canonicalItem` is stored but cannot join to any
recipe. The row says so, because otherwise the user concludes the recommender is
stupid when the real problem is dictionary coverage.

**Hard filters fail closed.** If the avoid list cannot be applied for any reason
— malformed payload, missing field — the endpoint returns *no results*, not
unfiltered ones. Every other failure here degrades toward "less helpful"; this
one degrades toward "shows nothing", because the alternative is surfacing an
allergen.

## Testing

Matching the layers the repo already runs (see `README.md`):

- **Go unit** (`internal/recommend`) — scoring is a pure function, so
  table-driven tests over `(context, candidates) → expected order`, with weight
  constants pinned. Two cases get dedicated tests rather than being folded in:
  an avoid-list ingredient must remove the recipe entirely, and marking a
  feature unavailable must not spuriously reorder results (the normalization
  guarantee above).
- **Go handler** — auth headers, body validation, limit clamping; mirrors the
  existing `handler_test.go`.
- **Convex unit** (`convex-test`) — affinity derivation (sign of added vs.
  dismissed, recency decay, the top-50 cap), preferences read/write, the
  `useItUp` mutation.
- **Integration** (the `recipes.integration.test.ts` pattern) — Convex action →
  real recipe-service → real scoring, no mocks. This is the seam that catches
  contract drift between the TS and Go type mirrors.
- **E2E** (Playwright) — mark a pantry item to use up → see a recommendation that
  cites it by name → add it to the plan. Navigation uses the `navigateTo()`
  nav-link helper, not `page.goto()`, which cancels in-flight Convex mutations.

## Increments

Following the pattern BL-0018 and BL-0021 used.

**Increment 1 — preferences + pantry intent.** `preferences` schema, `/settings`
form, avoid-list hard filter, `/recommendations/pantry`, use-it-up UX. This is
the differentiated half and it stands alone.

**Increment 2 — discovery + learning.** `/recommendations/discover`, the event
log, derived affinities.

## Risks

Ranked by impact on whether this feels smart or broken.

1. **Dictionary coverage (highest).** `normalization.json` canonicalizes 5 items
   and 3 synonyms. Every pantry↔recipe match joins on `canonicalItem`, so
   unrecognized ingredients do not match and coverage reads near-zero. This gates
   the *core* endpoint and is the single most leveraged fix — more so than corpus
   size. Tracked as BL-0031.
2. **Corpus size.** 6 catalog recipes makes `discover` a sort, not a
   recommender, until BL-0002 grows it. Known and accepted going in; the scoring
   machinery is correct and ready when the corpus arrives.
3. **Manual-entry friction.** The chosen leftover mechanic is the pattern
   BL-0021 identified as the pantry death spiral ("abandoned by week four").
   Seeding the picker from existing pantry rows and autocompleting against the
   canonical dictionary blunts it but does not eliminate it. Worth actually
   checking whether the screen still gets used in week three rather than
   assuming.
4. **No outflow signal.** Nothing ever leaves the pantry, so `have` over-reports
   what the user owns and the ranker will suggest recipes for ingredients already
   consumed. Dismissals partially compensate; BL-0028 is the real fix.
5. **Untuned weights.** Hand-tuned constants with no ground truth. Pinned by
   tests so changes are deliberate, but they are a guess until the event log
   makes tuning empirical.
6. **Non-reactive results.** An action-fetched surface in an otherwise-live app.
   Mitigated by refetching on pantry change.

## Deferred work

Each has a named home, and none blocks this spec:

| Deferred | Item |
| --- | --- |
| Catalog growth | BL-0002 |
| Dictionary population + `staple` flag | BL-0031 |
| Recipe discovery metadata (cuisine, tags, cook time) | BL-0030 |
| Pack-size residue inference + purchase-unit grocery lines | BL-0032 |
| Week-level "suggest my week" set optimization | BL-0033 |
| LLM candidate provider | BL-0034 |
| Cook-decrement | BL-0028 |
| Shelf-life / expiry urgency | BL-0029 |
| Cost and sale-aware ranking | BL-0023 increment 3 |

## Alternatives considered

- **A separate `apps/recommender` service** — matches BL-0005 as originally
  filed. Rejected *for now* because the ranker is stateless, so the coupling the
  item warns about does not exist, while a separate service would have to solve
  corpus access via HTTP-per-request, a shared database, or a synced index —
  each worse than a SQL join for a feature with no users. Revisit when the ranker
  needs real derived storage.
- **Scoring in Convex TypeScript** — pantry and preferences are already local,
  but the corpus is not, and Convex queries cannot do network I/O. It would have
  to be an action anyway, losing reactivity *and* pulling the corpus over HTTP
  per call. Wrong shape for a corpus scan.
- **Pack-size residue inference** — compute leftovers as purchased-minus-consumed
  by adding a purchase unit and typical pack size to each canonical ingredient.
  This is the more accurate mechanic and it would additionally fix the grocery
  list emitting recipe units nobody can buy ("2 tbsp parsley" when parsley is
  sold by the bunch). Deferred as BL-0032 because it depends on per-ingredient
  pack-size data that does not exist anywhere today.
- **Inference without confirmation** — surfacing inferred leftovers silently.
  Rejected: wrong entries never get corrected, and the recommender confidently
  suggests recipes for parsley thrown out weeks ago.
- **Facet-first preferences** — model taste as cuisines, diets, and effort, which
  is how users describe it. Rejected as the starting point because no recipe
  carries those fields, so every candidate would score neutral on every facet.
  Captured now, scored later.
- **Learned-only preferences** — infer everything from behaviour, no preference
  UI. This is where the model should end up, but it has no cold start at all.
  Arrives incrementally on top of ingredient-grounding via the event log.
- **A whole-week suggestion as the output unit** — propose a 5–7 recipe week
  optimized for variety and shared ingredients rather than ranking recipes
  individually. Genuinely the most valuable version of this product and the
  natural endgame given the planner exists, but it is a combinatorial layer on
  top of a per-recipe scorer and needs that scorer to be good first. Deferred as
  BL-0033; this design is a prerequisite, not a detour.
- **External recipe API as the corpus** — real breadth immediately, but a
  licensing and ToS problem. BL-0023's research already hit this wall with
  Spoonacular, whose terms forbid caching beyond one hour — flatly incompatible
  with storing recommendable recipes.
- **Impression (`shown`) events** — would enable click-through analysis, at the
  cost of dominating the event table by orders of magnitude to support analysis
  nobody is doing. Added/dismissed carry the signal that actually matters.
