---
id: BL-0038
title: Nutrition targets — declarative goals, evaluation, and diet presets
status: done
area: nutrition
effort: M
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

This is where the nutrition line pays off for the user: hitting a macro goal,
keeping to a low-cholesterol diet, staying low-carb, capping calories. The
design's central bet is that **these are not four features** — they are four
instances of one shape:

```
{ nutrientId, operator, value, period }
```

"150g protein per day", "cholesterol under 200mg per day", "carbs under 50g per
day" differ only in their field values. One evaluator serves all of them, and
serves goals nobody has specified yet. There is no `lowCarbMode` boolean
anywhere in the system.

Depends on **BL-0037** for the rollup it evaluates against.

## Proposal

- Convex table `nutritionTargets` — `{userId, nutrientId, operator, value,
  period, label?, active}`, indexed by user. One row per constraint; a macro goal
  is three or four rows, a low-cholesterol diet is one.
- A pure evaluator, `(targets, summedVector) → [{target, actual, status}]` with
  `status ∈ {met, under, over, unknown}`. **`unknown` propagates from low
  coverage** rather than being reported as zero — a missing ingredient must never
  read as "under your limit."
- **Diet presets are bundles of rows, not code.** "High protein", "low
  cholesterol", "low carb" ship as data, so new presets need no deploy.
- Surfaces: a goal editor in settings; per-day and per-week status on `/plan`;
  a "fits your goals" indicator on recipe cards using the `meal` period.
- The evaluator depends only on its arguments, making it the natural first
  tenant for `packages/core` (BL-0024). Until that package exists it lives in the
  web app as a pure, unit-tested module.

## Alternatives considered

- **Named diet modes** (`lowCarb: true`, `lowCholesterol: true`) with
  hardcoded thresholds. Faster to build the first two; every subsequent diet is
  another branch, and users cannot express "under 180mg" when the code says 200.
- **Free-text goals interpreted by an LLM.** Flexible input, but
  non-deterministic evaluation on a number the user is trying to trust, and it
  adds a model dependency to a pure arithmetic path. A natural-language
  *authoring* step that emits these rows is a reasonable fast-follow — the rows
  stay the source of truth.
- **Targets in recipe-service.** They are user data, not food knowledge, and
  they need reactivity; Convex is the right side of the split.
- **Percentage-of-calories macro targets** (e.g. "30% of calories from
  protein"). Common in fitness apps and expressible later as a derived nutrient
  or a second operator; absolute values cover the stated scenarios and keep the
  first evaluator trivial.
