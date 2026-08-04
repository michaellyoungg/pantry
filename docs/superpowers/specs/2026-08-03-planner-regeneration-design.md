# Planner regeneration & household scaling — design

*Date: 2026-08-03. Backlog: BL-0018 (meal planner), increment 2 completion.
Implements decision #2 of [the full-app UX plan](2026-07-12-full-app-ux-plan.md).*

## What this settles

Increment 2 of the planner shipped servings scaling, leftovers, and a merge that
preserved checked lines (PR #39). Two pieces of the specified behaviour were
still missing, and this design closes them:

1. **Regeneration flagged nothing.** The merge preserved a checked line only
   while the plan still wanted it; a line the plan *dropped* was deleted
   outright, ticks and all.
2. **The servings dial had no household default.** The stepper existed, but
   every recipe started at ×1 and there was nowhere to say how many people the
   household cooks for.

## 1. The three rules of a non-destructive regeneration

`groceryList.mergeGroceryList` is the single place a generated list meets an
existing one. It applies exactly three rules, keyed on `item + unit + aisle`:

| The plan… | The row… | Result |
| --- | --- | --- |
| still wants it | exists | **preserve** — keep `checked`, `alreadyHave`, `manual`; refresh quantity, provenance, shelf life; clear `removed` |
| newly wants it | absent | **merge** — insert unchecked, annotated against the pantry |
| no longer wants it | checked | **flag** — set `removed: true`, keep the row |
| no longer wants it | unchecked | delete |
| never produced it (`manual`) | exists | keep, and drop stale provenance |

### Why "flag if checked, delete if not"

The rule is about **user state, not tidiness**. A checked line is a decision the
shopper made — the item is in the cart — and it has already had a side effect:
check-off is the pantry's inflow signal (BL-0021), so deleting the row leaves a
pantry item with nothing left in the app explaining where it came from. Someone
standing in a store whose partner edits the plan at home must not watch a line
they have already picked up disappear.

An **unchecked** line carries no decision and no side effect. Deleting it is not
data loss; it is the list following the plan, which is the whole point of
pressing regenerate. Flagging those too would leave the list accumulating debris
after every plan tweak, and each one would need dismissing — friction on the
surface the UX plan says must stay effortless.

So the two literal readings of "preserve checked, merge new, flag removed"
collapse into one coherent rule: **regeneration may never undo something the
shopper did.**

### Consequences

- Flagged lines render in their own "No longer in your plan" section on `/list`,
  struck through, each with **Dismiss** (`groceryList.removeItem`, which now
  accepts a `removed` row as well as a `manual` one — no recipe will ever bring
  it back, so the shopper is the only one who can clear it).
- Home's counts and the price estimate are computed over the **active** half
  only: a flagged line is already bought, so counting it would both overstate
  "N items ready" and make the trip look further along than it is.
- If the dropped recipe returns to the plan, the next regeneration clears the
  flag and the line goes back to being ordinary — tick intact.

## 2. Household size seeds the servings dial

`preferences.householdSize` (optional, 1–20, whole people) is set on
`/settings`. It is *not* the multiplier: the multiplier scales ingredient
quantities, so a 4-serving recipe for a household of 4 is **one** batch, not
four. The derivation lives in `@pantry/core`:

```
defaultServingsMultiplier(householdSize, recipeServings)
  = undefined                                   if either is unknown
  = clamp(snapToStep(household / servings))     otherwise
```

- **`undefined`, not 1, when there is nothing to derive from.** BL-0035 made a
  recipe's yield nullable and most recipes have none; scaling by a guessed yield
  would silently buy the wrong amount. An unset dial is already how the planner
  spells "one batch", so this keeps "nobody scaled this" distinct from "this was
  scaled to 1".
- **Snapped to `SERVINGS_STEP`, ties rounding up.** The number shown must be one
  the − / + buttons can return to, and on a grocery list buying slightly too
  much beats not being able to cook the meal.
- **Applied on add, never on re-add.** `basket.add` writes the multiplier only
  when it inserts. Adding an already-planned recipe stays an idempotent no-op —
  re-adding is not the user asking to discard a dial they deliberately moved.

The client derives the value because a Convex mutation cannot fetch and the
recipe's yield lives in recipe-service — but the client already has the recipe
in hand at that moment. The server still clamps to the floor, because the clamp
has to hold for callers that never run the client's domain layer.

## Scope notes

- **"Over the visible week" is the whole plan surface**, scheduled days *and* the
  unscheduled rail, minus leftovers. There is only one week in the model today
  (weekday index, no week id — UX-plan decision #1 is still open), so "the
  visible week" and "the basket" are the same set. Excluding the rail would
  break the basket → list flow that predates the planner.
- **Leftovers stay asymmetric on purpose.** They contribute nothing to the
  grocery list (nobody shops for last night's dinner) but *do* count for
  nutrition (BL-0037/BL-0039 — it is food that gets eaten). These two are
  intentionally inconsistent; neither should be "fixed" to match the other.
