---
id: BL-0065
title: Native nutrition surfaces (facts panel, goals, plan rollup, recipe fit)
status: done
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

## Progress

**Done.** All seven surfaces are native, and everything behind them is shared.

**What moved into `@pantry/core`**, following the parity plan's §4 loop — port a
surface, push its wiring down, have web adopt the same hook:

- `nutritionGoals.ts` — the chips, the tones, the summary and the goal label,
  out of `apps/web/src/lib`. Plus three things the web components were deciding
  inline: the verdict a recipe gets (`goalVerdict` and `GOAL_VERDICT_LABELS`),
  the editor's period and operator vocabulary, and `parseGoalValue`. That last
  one is the reason it is shared rather than copied: `Number("")` is 0, so a
  second editor re-implementing the check is a second editor that will one day
  store "at most 0 mg of sodium" for a user who tabbed past the field.
- `nutritionRecipe.ts` — `recipeNutritionView` and `recipeGoalFit`, replacing
  `apps/web/src/lib/nutrition.ts`. It folds in the two rules `RecipeNutrition`
  was carrying: per-serving figures lead when the yield is known, and a recipe
  with **no** yield gets no personal column at all, because a `meal` target is
  written against one serving.
- `nutritionRollup.ts` gained `planGoalStatus` and `planNutritionView`, so a
  day's total, that day's label rows and its goal chips are all read off one
  response. Asking twice is precisely how the two halves of that card come to
  disagree about whether a day is knowable.
- `nutritionFacts.ts` gained the panel's title, its em-dash and its three
  footnotes. A disclaimer that lives on one client is a disclaimer the other is
  missing.
- Screen hooks: `useNutritionTargets` (one goal subscription for all four
  reading surfaces), `useRecipeNutrition`, `usePlanNutrition` and
  `useNutritionGoals`. The two estimate hooks take the injectable action wrapper
  `useRecipeDetail` established, so web keeps its traced actions.

The five web components are now presentation over those; 470 web tests pass, and
the evaluation two of the component suites used to drive through the DOM is
tested directly in `@pantry/core` instead.

**The panel.** The dense tabular label was the reason this item was L, and the
hard part was not the arithmetic — that was already pure — but the fact that
React Native has no `<table>`. Web's panel is a real table with scoped headers
*because* the row-and-column relationship is information. Native rebuilds that
relationship out of one `accessible` group per row whose label reads
"Sodium, 890 mg, 39% of the Daily Value", which is the same information by the
only means the platform offers. The em-dash is spoken as "not estimated" there:
a punctuation mark a screen reader may or may not voice is not a place to put
the difference between "we don't know" and "zero".

Both correctness properties the proposal named are preserved and asserted:

- **Coverage honesty.** A nutrient with no Daily Value leaves its cell blank, as
  the printed label does; a nutrient that has one we could not fill prints the
  em-dash the footnote defines. Nothing unmeasured ever renders as 0. The row
  set is fixed, so a recipe missing four nutrients yields a panel of the same
  shape as one missing none.
- **The Daily Value semantics.** The heavy rules are drawn from the row groups
  rather than from indices, so inserting a nutrient cannot move a divider; row 0
  draws no rule at all, because web's collapses into the header's and React
  Native has no border collapsing.

**Two native-only compositions**, both the pager's doing rather than a
concession:

- The planner's card answers for the week and for the day you have paged to.
  Web lists seven days at once under a seven-column grid; a phone showing one
  day at a time (BL-0064) would be repeating the pager's job seven times over.
  Nothing is unreachable — paging is how you reach the rest.
- The recipe's label sits behind a disclosure, with the verdict — the one line
  most cooks want — always visible. Fifteen rows of a regulatory panel between
  the ingredients and the method would bury what the cook opened the screen for.

The goal editor is the one surface that becomes a route of its own,
`/nutrition/goals`, linked from Settings. Web keeps it on `/settings` beside
four other cards and a phone has no room to stack an editor under them. Its
three `<select>`s become chip rows: a picker wheel for three options is a modal
for nothing, and the values and the words are the shared ones either way.

The alternative in the proposal — a summarised strip linking to web — was **not
taken**, and did not need to be.

One behaviour change beyond the port, on both clients: the goal editor no longer
flashes "No goals yet" before the first response. `useNutritionTargets`
distinguishes "loading" from "none", so the copy can too.

Verified: `pnpm check` green — core (769 tests), web (470), mobile (413 across
43 suites), Convex, typecheck, type-aware lint, knip, contract freshness.

Not in scope and still open: `HabitReview` (BL-0039), which belongs to the
History route and its own port, BL-0067.
