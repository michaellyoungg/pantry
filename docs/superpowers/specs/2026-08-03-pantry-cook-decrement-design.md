# Pantry thin loop — increment 2: cook-decrement

- **Backlog item:** [BL-0028](../../backlog/BL-0028-pantry-cook-decrement.md)
- **Builds on:** [increment 1](2026-07-18-pantry-thin-loop-design.md) (BL-0021)
- **Date:** 2026-08-03
- **Status:** implemented

## Summary

Marking a planned meal cooked steps each of its normalized ingredients one notch
down the pantry: `have → low → out`, floored at `out`. This is the outflow half
of the loop increment 1 left open.

Increment 1's own design named the risk it was leaving behind: with nothing
consuming anything, the pantry fills up permanently and "don't rebuy" starts
suppressing items the user genuinely needs. The manual `have → low → out` cycle
was shipped as the escape hatch. This increment makes the loop close on its own.

Still coarse. Still no quantities — that is the increment's stated non-goal, not
an omission.

## The missing prerequisite: `markCooked`

Increment 1 deferred this work because it needs a "mark cooked" event on the
planner, which was BL-0018's territory and **was never built** — a grep found
`markCooked` only in prose. Nobody was holding BL-0018, so this changeset lands
it, as its own commit ahead of any pantry behaviour.

The event is a single optional field on the plan entry:

```ts
basket: defineTable({
  …
  cookedAt: v.optional(v.number()),   // absent = not cooked
})
```

**Why a field on `basket` and not a new `cookedLog` table.** It is state about a
planned meal, so it lives on the planned meal: no new table, no new index, no new
scoping rules, and it disappears with the plan entry it describes. BL-0039 is
concurrently building `nutritionLog`, designed so a `mark cooked` event can
upgrade a `source: planned` row to `cooked`. A second cooked-log here would be a
competing record of the same fact for that item to reconcile; a timestamp on the
plan entry is a signal it can consume instead.

`markCooked` is idempotent — it writes `cookedAt` once and a second call is a
no-op — and `unmarkCooked` clears it.

## Idempotency: a cooked-log guard, not a per-cook step

The backlog item asks for a deliberate choice here. **Chosen: the guard.**

A per-cook step (decrement on every press, no memory) is one line shorter and
wrong in the way that matters: a double-click, a retried mutation, or a second
tab drives an item from `have` straight to `out`, and the user's evidence that it
happened is a grocery list that has quietly started re-buying things. The backlog
item calls this out by name.

`cookedAt` is that guard, and it is a good one because **the guard and the
trigger are written in the same transaction**. `markCooked` checks the field,
sets it, and schedules the decrement in one mutation, so they cannot disagree:
the decrement is queued exactly once per cook, even under concurrent calls.

**Un-marking is a deliberate hole in the guard.** `unmarkCooked` clears the flag,
so mark → unmark → mark steps the pantry twice. That is intended: the user has
asserted two separate cooks. The guard defends against *repeating the same
assertion*, which is the failure mode that actually occurs. Un-marking also does
**not** put the pantry back — "I didn't cook this" is a correction to the plan
record, and re-inflating `low` back to `have` would be a guess about food. The
pantry page's manual cycle is where inventory gets corrected.

## Resolving the recipe's ingredients

The decrement must key on `canonicalItem` — the recipe-service normalization id
that the inflow loop and the grocery list already use — so a cooked recipe
decrements exactly the rows check-off created. Keying on display text would match
nothing and fail *silently*, which is the same class of bug as the catalog
ownership mismatch that produced an empty grocery list earlier in this repo. It
has its own test.

That mapping lives in Go, and **a Convex mutation cannot do network I/O**, so
resolution runs in an action. `markCooked` *schedules* it rather than awaiting
it:

```
markCooked (mutation)          → patches cookedAt, schedules ↓
pantry.cookDecrement (action)  → POST /grocery-list for one recipe → canonical ids
pantry.applyCookDecrement (mutation) → steps the rows
```

Two reasons for the scheduler rather than making the whole thing an action:

1. Recording that you cooked dinner should not fail because recipe-service is
   down. The plan record is the user's; the pantry step is a consequence of it.
2. The guard has to be transactional with the trigger (above), and only a
   mutation can be.

The cost is that a failed decrement is silent. It is recoverable through the
manual cycle — which is precisely why increment 1 made that escape hatch
mandatory rather than polish.

`POST /grocery-list` for one recipe at multiplier 1 is reused as the
ingredients → canonical-items endpoint rather than adding a Go route: it already
returns `canonicalItem` per line (increment 1 plumbed it). Only the keys are
used; the quantities are discarded, because the pantry has none.

## Rules the decrement follows

| Rule | Why |
|---|---|
| `have → low`, `low → out`, `out → out` | Coarse by design; `out` is the floor — there is nothing below "you're out of it" |
| Missing rows are **not** created | An `out` row for every spice a recipe mentions would bury the pantry page; "absent" already reads as "not tracked" everywhere in this loop |
| `source: manual` rows **are** stepped | Cooking consumes food whoever entered it. The opposite of `removeAutoRow`, which must never touch curated rows — that is a bookkeeping correction, this is a physical event |
| Duplicate canonical ids step once | A recipe can list one ingredient on two lines (non-convertible units); one cook is one notch |
| Already-`out` rows are not written at all | Avoids churning `updatedAt` for a no-op |
| Leftovers do not decrement | Reheating consumes nothing new — the same rule that keeps leftovers off the grocery list. The event is still recorded, so a nutrition log still sees the meal |

`useBy` is untouched: `lib/expiry.ts` already excludes `state === "out"` from the
"use this week" batch, so an item stepped to `out` leaves the nudge on its own.

## Web

One control per planned meal in `WeekPlan`, in the existing meta row beside the
leftover toggle. Deliberately no restructuring of that component: BL-0038 and
BL-0039 are editing it in parallel. Leftovers read "eaten" rather than "cooked".
`isCooked` joins `isLeftover` in `@pantry/core` so a second client gets the same
predicate.

## Testing

| Layer | Coverage |
|---|---|
| `basket.test.ts` | `cookedAt` stamped once; second mark keeps the first timestamp; unmark clears; no-op off-basket; another user's entry untouched |
| `pantry.test.ts` | `steppedDown` as a pure function; each ingredient steps one notch; never below `out`; keyed on `canonicalItem` not display; **double-cook does not double-step** (and never even calls recipe-service); step-again after unmark; untracked ingredients create no rows; manual rows step; cross-user isolation; leftovers inert; the request shape sent to recipe-service |
| `planner.test.ts` | `isCooked` — presence of the timestamp, so `cookedAt: 0` still counts |
| `WeekPlan.test.tsx` | the control's label/`aria-pressed` in both states, "eaten" for leftovers, mutation fires |

**A trap worth recording.** `markCooked` schedules the decrement with
`runAfter(0)`, and under `convex-test` nothing scheduled runs until timers
advance. Without `vi.useFakeTimers()` plus
`t.finishAllScheduledFunctions(vi.runAllTimers)`, the action fires *after* the
test tears down its stubs — the failure looks exactly like "the decrement did
nothing", and a test written to assert the decrement happened would instead
quietly assert against an un-run function.

No new e2e spec: the browser loop this adds is one button, and the behaviour
worth pinning is server-side state transitions, which the Convex tests cover
directly.

## Deferred

- **Upgrading `nutritionLog` rows from `planned` to `cooked`.** BL-0039 owns
  that; this increment only emits the event it is waiting for.
- **Re-keying `mergeGroceryList` on `canonicalItem`** — still open from
  increment 1.
