---
id: BL-0064
title: Native week planner
status: proposed
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

## Alternatives considered

- **Reproduce the seven-column grid.** Direct, and unusable in portrait.
- **Defer planning to the web permanently.** Planning is genuinely a
  sit-down-with-a-coffee activity, so this is the strongest candidate in the
  whole app for a permanent web-only route. Rejected against the parity target,
  but worth revisiting if Phase 4 runs long.
