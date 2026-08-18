---
id: BL-0065
title: Native nutrition surfaces (facts panel, goals, plan rollup, recipe fit)
status: in-progress
area: mobile
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The nutrition system (BL-0036 through BL-0040, BL-0049) is the largest feature
area added since the 2026-07-18 mobile design was written, and it spans several
surfaces: the Nutrition Facts panel, plan-level rollups, goal status, targets
and presets, and per-recipe goal fit.

Nearly all of it is already pure and portable — `packages/core` holds
`nutrition`, `nutritionFacts`, `nutritionRollup`, `nutritionTargets`,
`nutritionHistory`, and `dietPresets`. This item is view work over logic that
already exists.

## Proposal

Port `NutritionFactsPanel`, `NutritionGoals`, `PlanNutrition`, `PlanGoals`,
`RecipeNutrition`, `RecipeGoalFit`, and `GoalStatus` to native views.

Two things to preserve exactly, because they are correctness properties rather
than presentation:

- **Coverage honesty.** An em-dash and a blank mean two different absences; a
  nutrient that is unknown must never render as zero.
- **The Daily Value label semantics** from BL-0049 — the panel is a recognisable
  US Nutrition Facts label, and the layout carries meaning.

A dense tabular label is the single hardest thing in this app to render well on
a narrow screen, and is the main reason this item is L rather than M.

## Alternatives considered

- **Show a summarised nutrition strip on mobile and link to the web for the full
  label.** Pragmatic, and would cut this item roughly in half. Rejected against
  the parity target, but it is the most defensible partial-parity compromise in
  the plan if Phase 4 runs long.
