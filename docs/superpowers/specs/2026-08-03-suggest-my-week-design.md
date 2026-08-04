# "Suggest my week" — set-level meal plan selection (BL-0033)

Status: implemented
Backlog item: BL-0033
Depends on: [BL-0005 recommendations design](2026-08-03-recommendations-design.md),
[full-app UX plan](2026-07-12-full-app-ux-plan.md)

## What this is

One action on `/plan` that proposes a whole week of dinners at once, optimized
for the two properties that only exist across a plan: **shared ingredients**, so
the week produces one short grocery list rather than five disjoint ones, and
**variety**, so it is not the same dish four nights running.

It is a **selection strategy layered on the existing per-recipe scorer**, not a
second scorer. Every candidate arrives already ranked by
`internal/recommend`, and its score is used unchanged. BL-0005's feature vector
is untouched by this work.

## Where the pieces live

| Piece | Home | Why there |
| --- | --- | --- |
| Per-recipe scoring | `apps/recipe-service/internal/recommend` | Unchanged. The corpus lives next to it. |
| Greedy set selection | `packages/core/src/weekSuggestion.ts` | Pure, platform-free, and re-runnable per keystroke as the user edits the proposal. |
| Candidate supply | `packages/convex/convex/recommendations.ts` → `weekCandidates` | Convex queries cannot do network I/O; this is the same action shape the pantry surface uses. |
| The surface | `apps/web/src/components/SuggestWeek.tsx` | Renders a proposal and owns the accept step. |

Selection is deliberately **not** in Go. The marginal-gain terms need only each
candidate's score and its canonical ingredient split, both of which the existing
`/recommendations/pantry` response already carries (`have` ∪ `missing` is the
recipe's deduplicated ingredient set). Putting selection on the client makes
every edit to the proposal free — no round trip to drop a dinner and refill its
day — which is what lets the proposal stay editable and unsaved.

## The algorithm

Greedy marginal gain. Take the best candidate, re-score the remainder against
what is now chosen, repeat until the open days are full.

```
marginal(c, S) = score(c)
               + 0.35 × shoppingOverlap(c, S)
               - 0.80 × repetition(c, S)
```

- **`shoppingOverlap`** — the share of `c`'s *missing* items that the week is
  already buying. Measured on what you must **buy**, not on all ingredients:
  sharing a pantry staple you already own saves nobody a trip, and the shopping
  list is what this term exists to shorten. A candidate needing nothing scores 1
  — it adds no line at all.
- **`repetition`** — the peak Jaccard similarity against any already-chosen
  dinner, over the *whole* ingredient set, rescaled so everything at or below
  `VARIETY_SIMILARITY_THRESHOLD` (0.35) is free and identity is 1. Peak rather
  than mean: one near-duplicate is the thing being prevented, and a mean would
  let it hide behind four dissimilar picks.

### Why the threshold is load-bearing

The first implementation had an ungated Jaccard penalty and it **cancelled its
own overlap bonus**. Two dishes sharing one ingredient out of four already sit
at a Jaccard of 0.33; the penalty that produced took back almost exactly what
the overlap bonus had just granted, so "shares a chicken" and "shares nothing"
scored the same and the feature did nothing.

Gating the penalty separates the two intents cleanly:

- sharing ingredients is the **goal**, and is never punished;
- being the *same dish again* is punished hard, on a ramp from the threshold to
  identity.

The penalty weight (0.8) then has to exceed the bonus (0.35), because a
near-duplicate collects the full overlap bonus by definition — sharing
ingredients is exactly what duplicates do.

Both constants are hand-tuned and pinned by a test, the same convention
`DefaultPantryWeights` follows: a retune should be a deliberate, visible diff.

## Locked days

Days that already hold a scheduled meal are never proposed for and never
written to — the same non-destructive diff-merge instinct BL-0018 used for
grocery regeneration. Someone who has planned Wednesday must not lose it by
pressing a button that offered them more.

Locked meals do more than block a day: their ingredients **seed** the chosen set,
so a candidate that shares Wednesday's chicken is scored as the good outcome it
is. This is why `weekCandidates` sends `excludeRecipeIds: []` — the planned
recipes' ingredients have to come back for that to be possible, and it is the
client's job not to re-propose them.

An unscheduled basket row is *not* locked. Placing it on a day is precisely the
help the user asked for.

## `includeUnmatched`

One additive field on `recommend.UserContext`, defaulting to false so the pantry
surface is unchanged. It keeps candidates that share nothing with the pantry,
which `RankPantry` otherwise drops.

That filter is right for "cook what you have" — a recipe with no pantry hit has
nothing to say about your fridge — and wrong here twice over:

1. a dish can earn its place by sharing ingredients with the **other** dinners,
   which is the entire premise of set selection; and
2. a new user has an empty pantry, so without it "Suggest my week" would answer
   "no week" to exactly the person it is most useful to.

Hard filters are unaffected: the avoid list still runs before scoring.

## Explaining the set

Per-recipe reasons already exist and are passed through untouched. The set-level
account is the new thing, and it is the point of the feature — per-recipe scores
do not justify bundling five of them into one action.

Every line is **derived and checkable**, never asserted:

- `3 dinners share chicken` — counted across the chosen set.
- `One shopping list: 14 things to buy, not 22` — distinct vs. summed missing
  items. Suppressed when there is no saving; the feature does not boast about
  work it did not do.
- `4 of 5 use something you already have` — counted.
- `5 dinners, no two alike` — only claimed when peak pairwise similarity is
  under the variety threshold, and only for three or more dinners.

## Propose, never apply

Nothing is written until the user presses **Add to my week**. Until then the
whole proposal is component state: dropping a dinner refills its day locally,
"Try again" turns the current set down and draws another, and "Discard" costs
nothing. The UX plan's anti-friction principle is explicit that a suggestion the
user must undo is worse than no suggestion, and a planner that silently rewrote
itself would be exactly that.

Accepting is `basket.add` then `basket.schedule` per pick. Both are idempotent
and neither can touch a locked day, because locked days were never in the
proposal.

## Alternatives considered

- **Exact optimization (ILP)** — better sets in principle; badly disproportionate
  for 5–7 picks from a small corpus, and the result is not explainable, which
  costs more than the quality gains.
- **Selection in Go** — keeps all scoring in one package, and would get the
  locked-meal ingredients without widening the request. Rejected because every
  edit to the proposal would become a round trip, and the proposal being cheap
  to edit is what makes it safe to never apply.
- **Applying the suggested week directly** — fewer taps, overwrites user intent.
  Explicitly rejected by the backlog item.
- **Cuisine / protein diversity** — the item's context names variety "across
  cuisines and proteins". Those fields do not exist on a recipe yet (BL-0030 /
  BL-0020), so the ingredient-set similarity is the available proxy. When that
  metadata lands, it becomes a second dimension of the same `repetition` term.

## Known limitations

- **Every candidate ties at an empty pantry.** With nothing in the pantry the
  coverage feature is 0 for everyone, so the first pick is decided by the
  recipe-id tiebreak. The set terms still shape picks 2..n, so the *week* is
  still coherent, but the entry point is arbitrary until there is pantry state or
  a second available feature (BL-0031's `staple` flag revives
  `missingNonStaple`, which would break the tie honestly).
- **Days are filled in calendar order**, best pick first. There is no notion of
  "quick dinner on a weeknight" — that needs BL-0030's cook-time metadata.
- **A 50-candidate pool.** Greedy over the ranker's `maxLimit`; the corpus is
  small enough that this is effectively the whole corpus today.
