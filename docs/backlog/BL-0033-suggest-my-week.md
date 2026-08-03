---
id: BL-0033
title: "Suggest my week" — set-level meal plan optimization
status: proposed
area: recommendations
effort: L
related_specs: [2026-08-03-recommendations-design.md, 2026-07-12-full-app-ux-plan.md]
created: 2026-08-03
---

## Context

BL-0005 ranks recipes **individually**. The most valuable version of this product
ranks a **set**: propose a whole week at once, optimized for the properties that
only exist across a plan — variety across cuisines and proteins, and shared
ingredients so five dinners produce one short grocery list instead of five
disjoint ones.

The UX plan's Phase 3 names "recommendations / For You plans" as a vision item,
and the planner (BL-0018) already owns the week model this would fill.

This is deliberately *after* per-recipe scoring: set optimization is a
combinatorial layer on top of a scorer, and it needs that scorer to be good
first. The BL-0005 design is a prerequisite, not a detour.

## Proposal

- **Greedy marginal-gain selection** over the existing per-recipe scorer: pick
  the best recipe, then re-score the remainder with a bonus for ingredient
  overlap with what is already chosen and a penalty for similarity to it, and
  repeat until the week is full. Cheap, explainable, and reuses BL-0005's feature
  vector unchanged.
- **Surface it as one action** on `/plan` — "Suggest my week" — producing a
  fully-editable proposed plan, never an applied one. The UX plan's anti-friction
  principle means a suggestion the user must undo is worse than no suggestion.
- **Explain the set**, not just each recipe: "3 dinners share the same rotisserie
  chicken", "one short shopping list".
- **Respect locked days.** Regenerating should leave already-scheduled meals
  alone — same diff-merge instinct the grocery list uses.

## Alternatives considered

- **Exact optimization (ILP or similar)** over the full corpus — better solutions
  in principle, badly disproportionate for a week of 5–7 items chosen from a
  small corpus, and much harder to explain to a user.
- **Template weeks** ("Taco Tuesday", "copy last week") — genuinely useful and
  much cheaper, but it is a different feature: repetition rather than
  suggestion. Worth filing separately.
- **Applying the suggested week directly** — fewer taps, but it overwrites user
  intent, which is the exact resentment competitors get abandoned for.
