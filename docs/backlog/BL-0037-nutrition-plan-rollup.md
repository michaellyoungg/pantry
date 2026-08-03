---
id: BL-0037
title: Nutrition plan rollup — day and week totals on the planner
status: proposed
area: nutrition
effort: M
related_specs: [2026-08-03-nutrition-system-design.md, 2026-07-12-full-app-ux-plan.md]
created: 2026-08-03
---

## Context

Per-recipe nutrition (BL-0036) answers "what's in this dish?" The question a
user actually acts on is "what does my week look like?" — the same shift the
grocery list already makes when it aggregates a plan into one list.

The planner (BL-0018) already carries everything needed: basket entries with
`weekday`, `servingsMultiplier`, and `type` (`meal` | `leftover`). The Go side
already has `ScaledRecipe` and `AggregateScaled` for exactly this pattern on the
grocery path, so the nutrition rollup should mirror it rather than invent a
parallel mechanism.

Depends on **BL-0036**.

## Proposal

- Endpoint `POST /nutrition/estimate` taking `{items: [{recipeId, multiplier}]}`
  — the same request shape the grocery-list aggregation already accepts —
  returning one combined `NutritionEstimate`. Reuses `ScaledRecipe`; no new
  scaling logic.
- Convex action fans the week's basket entries into per-day and whole-week
  calls.
- `/plan` shows per-day energy plus macros and a week summary. Coverage travels
  with the rollup: a day containing one unresolvable recipe says so rather than
  quietly under-reporting.
- **Leftovers contribute nutrition but not groceries** — the inverse of the
  grocery rule, where a leftover occupies a slot and contributes nothing to the
  list. A leftover is food that gets eaten, so it counts here.

## Alternatives considered

- **Summing per-recipe estimates client-side.** Simpler and needs no new
  endpoint, but it means N round trips per week view and pushes coverage
  arithmetic into the UI, where it would be duplicated by every future client.
- **Caching a nutrition vector per basket entry in Convex.** Faster reads, but
  it duplicates food knowledge in the user-data store and goes stale on recipe
  edit. Only `nutritionLog` (BL-0039) snapshots a vector, and that is a
  deliberate exception for history stability.
- **Waiting for BL-0038 and shipping goals and rollups together.** The rollup is
  useful on its own — "this week is 2,400 kcal/day" needs no configured target —
  and shipping it first de-risks the aggregation before goals depend on it.
