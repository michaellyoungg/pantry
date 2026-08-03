# Pantry thin loop — increment 1: inflow + don't-rebuy

- **Backlog item:** [BL-0021](../../backlog/BL-0021-pantry-thin-loop.md)
- **Date:** 2026-07-18
- **Status:** approved, ready for implementation planning

## Summary

Give the pantry an inflow (checking an item off the grocery list records that you
own it) and make that knowledge pay for itself immediately (list generation marks
items you already have). Quantities are deliberately coarse — `have | low | out`,
never numbers.

This is **increment 1 of three**. Cook-decrement and shelf-life/expiry nudges are
explicitly out of scope; see [Deferred work](#deferred-work).

## Context

BL-0021 as filed bundles four features, and its stated dependency — the planner's
"mark cooked" event from BL-0018 — **was never built**. Grep finds `markCooked`
only in prose (this spec's backlog item and the UX plan); `basket.ts` exposes
`list, add, remove, schedule, unschedule, updateTitle, setServings, setType` and
nothing more. BL-0018 is still `in-progress`.

Rather than block on another agent's item or absorb its scope, increment 1 takes
the half of BL-0021 that has no such dependency. The inflow signal (check-off) and
the payoff (don't-rebuy) are both self-contained, and together they are the part
the backlog item calls "the tangible money-saving win."

Two facts about the existing code shape this design:

- **Grocery lines carry no normalized identity.** `Aggregate` keys its accumulator
  on `canonical` and then emits `a.display` (`apps/recipe-service/internal/recipe/aggregate.go:50,89`).
  The canonical key is computed and thrown away. `GroceryLine` is
  `{item, unit, quantity, aisle}` (`packages/types/src/index.ts:16-21`).
- **The `/pantry` route already exists** as an 18-line "Coming soon" stub
  (`apps/web/src/routes/pantry.tsx`), and `Nav.tsx:10` already links to it.

## Design

### 1. Data model

A new Convex table:

```ts
pantryItems: defineTable({
  userId: v.string(),
  canonicalItem: v.string(),   // "green onion" — Go's normalized key
  display: v.string(),         // "Green onion"
  aisle: v.string(),
  state: v.union(v.literal("have"), v.literal("low"), v.literal("out")),
  source: v.union(v.literal("auto"), v.literal("manual")),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_item", ["userId", "canonicalItem"])
```

`by_user_item` makes both the check-off upsert and the don't-rebuy diff index
lookups rather than table scans.

`state` is coarse on purpose. Numeric quantities drift from reality within days
(partial use, spoilage, untracked purchases) and the backlog explicitly warns
against modelling them. Only `have` suppresses re-buying; `low` and `out` are
retained so the row can carry forward into increment 3's nudges.

`source` distinguishes rows created by check-off from rows the user curated. It is
what lets un-checking undo an auto-add without ever destroying hand-entered data.

`userId` scoping follows the existing convention exactly: `v.string()` field, a
`by_user` index, `getAuthUserId(ctx)` with a null check at the top of every
handler, and an ownership re-check on single-row lookups.

### 2. Plumbing `canonicalItem` end to end

Pantry identity must be the *normalized* ingredient, not the display string, or
"Green onion" and "green onions" become two rows. That key exists today only
inside Go. Five coordinated changes surface it:

| # | File | Change |
|---|---|---|
| 1 | `apps/recipe-service/internal/recipe/types.go` | `GroceryLine` gains `CanonicalItem string \`json:"canonicalItem"\`` |
| 2 | `apps/recipe-service/internal/recipe/aggregate.go` | emit `CanonicalItem: k.item` in the `for _, k := range order` loop — the canonical key is already the accumulator map key, so the `acc` struct needs no new field |
| 3 | `packages/types/src/index.ts` | `GroceryLine` gains `canonicalItem: string` |
| 4 | `packages/convex/convex/groceryList.ts` | `groceryLineValidator` gains the field |
| 5 | `packages/convex/convex/schema.ts` | `groceryList` table gains `canonicalItem: v.optional(v.string())` |

The compile-time equality guard at `groceryList.ts:18` pins the validator to the
shared type, so steps 3 and 4 cannot drift apart silently — if one is missed, the
build fails.

**Two deliberate restraints:**

- The table field is **optional**. Existing rows stay valid, no backfill or
  migration is needed, and lines regenerate on the next `generateGroceryList`
  anyway. Lines lacking the field simply never match a pantry row.
- **`mergeGroceryList.keyOf` is left alone.** It keeps keying on
  `` `${item} ${unit} ${aisle}` ``. Re-keying the merge on canonical identity is a
  real behavioral change to check-state preservation across regenerations, and it
  does not belong in the same changeset as a new feature. `canonicalItem` rides
  along as data in this increment.

### 3. Inflow — auto-add from check-off

`toggleItem` (`packages/convex/convex/groceryList.ts:80`) is the single hook point.
It currently does exactly `ctx.db.patch(id, { checked })`. It gains:

- **on `checked: true`** — upsert a pantry row for the line's `canonicalItem` with
  `{state: "have", source: "auto", updatedAt: Date.now()}`. Upsert, not insert, so
  re-checking an item is idempotent. If a row already exists, its `state` is set to
  `have` and `updatedAt` refreshed; its `source` is **not** downgraded from
  `manual` to `auto`.
- **on `checked: false`** — delete the matching row **only if `source === "auto"`**.
  A manually curated row is never touched by a checkbox.
- **when the line has no `canonicalItem`** (an older row) — do nothing extra.

Because this is the same Convex mutation, it is one transaction: a failed pantry
write cannot leave a checkbox claiming success. That atomicity is a feature, not
an accident, and the tests assert it.

The upsert/undo logic lives in a helper in a new `packages/convex/convex/pantry.ts`
so `toggleItem` stays thin and the behavior is unit-testable on its own.

There is **no settings toggle** for inflow exceptions (YAGNI). The pantry page's
remove affordance is the exception mechanism.

### 4. Don't-rebuy

Implemented in `mergeGroceryList`, which already holds `userId` and performs the
writes. Before merging, it loads pantry rows with `state === "have"` via
`by_user`, builds a `Set<canonicalItem>`, and stamps each line with
`alreadyHave: v.optional(v.boolean())` (new optional field on the `groceryList`
table).

A `needItAnyway` mutation clears the flag for one line. It does **not** mutate the
pantry row — the user is saying "this list is wrong", not "I no longer own this".

**The list is annotated, never filtered or reordered.** Two reasons:

1. A stale pantry row should cost the user a glance, not a missing dinner
   ingredient discovered at the stove.
2. `GroceryList.tsx:25-31` builds aisle sections by scanning for *consecutive*
   same-aisle runs. Reordering lines would silently shatter the aisle headers.

### 5. Web UI

`routes/pantry.tsx` becomes a thin shell (`<h2>` + feature component), matching
every other route. The real component is `apps/web/src/components/Pantry.tsx` —
components rather than routes because `src/routes/**` is excluded from coverage
thresholds in `vite.config.ts:32-37`.

- **Pantry page:** rows grouped by aisle. Tapping a row cycles
  `have → low → out → have` via `api.pantry.setState`; a remove button deletes via
  `api.pantry.remove`. Empty state explains that checking items off the grocery
  list fills this in.
- **Grocery list:** an `already have` badge on flagged lines, visually
  de-emphasized but still checkable, plus a `need it anyway` action.

Optimistic updaters go in `apps/web/src/lib/optimistic.ts` as pure
`(localStore, args) => void` functions alongside `toggleItemOptimistic`, and are
unit-tested independently of React. Errors surface through the existing
`useAsyncAction` + `<ErrorText />` pattern.

### 6. Avoiding an absorbing state

With cook-decrement deferred, nothing would otherwise move an item out of the
pantry — it would fill up permanently and don't-rebuy would begin suppressing
things the user genuinely needs. This is the same class of bug as the blocking
review finding on BL-0017, where `shopped` was an absorbing dashboard state.

The manual `have → low → out` cycle and the remove button are the escape hatch,
and they are **required** in this increment, not optional polish. Only `have`
suppresses re-buying, so stepping an item to `low` immediately restores it to
normal list behavior.

No time-based auto-expiry in this increment: an arbitrary staleness constant is a
guess dressed up as data, and it belongs with increment 3's real shelf-life table.

## Testing

| Layer | Coverage |
|---|---|
| Go (`aggregate_test.go`) | canonical key is emitted on every line, including unknown/passthrough items |
| Convex (`pantry.test.ts`) | upsert idempotency; `auto` undo on uncheck; `manual` rows survive uncheck; state cycle; cross-user isolation |
| Convex (`groceryList.test.ts`) | check-off creates a pantry row; uncheck removes it; `alreadyHave` stamped only for `state === "have"`; lines without `canonicalItem` are inert |
| Web (`Pantry.test.tsx`) | aisle grouping, state cycle, remove, empty state |
| Web (`optimistic.test.ts`) | new updaters as pure functions |
| E2E (`core-loop.spec.ts`) | check an item off → it appears on `/pantry` → regenerate → line shows "already have" |

E2E navigation uses the existing `navigateTo()` nav-link helper rather than
`page.goto()`, which cancels in-flight Convex mutations and would race the
check-off write this feature depends on.

## Deferred work

These remain open under BL-0021 and should be filed as increments when this lands:

- **Increment 2 — cook-decrement.** Requires a `markCooked` event on `basket`,
  which is BL-0018's territory. Marking a planned recipe cooked steps its
  normalized ingredients `have → low → out`.
- **Increment 3 — shelf-life and expiry nudges.** Needs real data:
  `normalization.json` currently defines 5 items and 7 aisles, so a shelf-life
  table hung off it today would be mostly `other`. Wants a per-item
  `shelfLifeDays` plus an aisle-level default, and likely an endpoint exposing
  normalization data to Convex (none exists).
- **Re-keying `mergeGroceryList` on `canonicalItem`**, once there is appetite for
  changing check-state preservation semantics.

## Alternatives considered

- **Pre-checking owned lines** (`checked: true`) instead of badging them — reuses
  the existing checkbox with no new UI, but conflates "I own this" with "I put it
  in the cart" and corrupts the shopped-state math the Home dashboard reads.
- **Omitting owned lines entirely** — shortest list, but one stale pantry row
  silently removes an ingredient. Rejected: silent omission is the failure mode
  that kills trust in the feature.
- **Numeric quantity + unit** on pantry rows — more powerful for "do I have
  enough", but drifts fast and the backlog warns against it directly.
- **Building `markCooked` first** — more correct ordering, but grows increment 1
  and risks colliding with whoever holds BL-0018.
