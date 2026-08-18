---
id: BL-0064
title: Native week planner
status: done
area: mobile
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

`/plan` is the most interaction-heavy route in the app: day buckets, an
unscheduled rail, servings multipliers, leftovers, cooked marking, Suggest My
Week (BL-0033), and the nutrition/goal strips that ride alongside it.

Expected to be the hardest view port in the parity phase — the web version leans
on hover, drag-adjacent affordances, and a wide two-dimensional layout, none of
which survive a 390px portrait screen unchanged.

## Proposal

Port the week plan to native. All bucketing, clamping, and suggestion logic
already exists in `@pantry/core` (`planWeek`, `servingsMultiplier`,
`increaseServings`/`decreaseServings`, `unscheduledItems`, `suggestWeek`) and is
consumed unchanged — this item is genuinely view-only.

The design work is finding a phone-native equivalent for moving a recipe between
days. A day-at-a-time pager with an explicit "move to…" action is likely to beat
a miniature version of the desktop grid; that decision belongs in this item.

## Decision: a day pager, and an explicit "Move to…"

Settled during implementation, as this item asked.

- **The week is a selector, not a grid.** Seven columns at 390pt gives each day
  ~50pt, which is not enough for a recipe title. A strip of seven chips picks
  one day; that day's meals get full-width cards below it.
- **Moving a meal is an explicit action.** "Move" on a card opens a bottom sheet
  naming the meal and offering seven real targets plus "Take off the plan" —
  the day it is on now is shown but disabled. Web's day picker is a row of 6pt
  squares, hittable only with a cursor.
- **The selected day is the rail's target.** A recipe waiting to be planned gets
  one button, "Plan for Thursday", instead of a seven-square picker per row.
  This is what the pager buys: the screen already knows which day is meant.
- **Moving follows the meal.** Choosing a new day also moves the pager to it,
  or the meal appears to vanish.

Two strips the web planner carries are **not** in scope here: the nutrition and
goal rollup (BL-0065), and the lead-time prep badge, whose derivation still
lives in `apps/web/src/lib` and moves down with BL-0061.

## Alternatives considered

- **Reproduce the seven-column grid.** Direct, and unusable in portrait.
- **Drag-and-drop between days.** The gesture web users reach for, but it needs
  both days on screen at once, which is the constraint that ruled the grid out.
- **Defer planning to the web permanently.** Planning is genuinely a
  sit-down-with-a-coffee activity, so this is the strongest candidate in the
  whole app for a permanent web-only route. Rejected against the parity target,
  but worth revisiting if Phase 4 runs long.
