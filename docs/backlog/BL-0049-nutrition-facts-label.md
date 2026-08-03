---
id: BL-0049
title: Nutrition Facts panel — show estimates as the US Daily Value label people already know
status: proposed
area: nutrition
effort: M
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

The nutrition line now produces good numbers — per-recipe estimates (BL-0036),
day and week rollups (BL-0037), personal targets (BL-0038) — and presents all of
them as a bare grid of label/value pairs. It is honest and it is unfamiliar.

Every American has read a Nutrition Facts panel. Nobody had to be taught the
heavy rule under Calories, or that the number on the right is "how much of my
day does this cost me". That literacy is free to us and we are declining it: a
user reading `Sodium 890 mg` has to know that 2,300 mg is a day's worth before
the figure means anything, whereas `Sodium 890mg — 39%` means something
immediately.

This item changes presentation only. No new estimation, no schema, no new data
source. The same vectors that feed today's grid feed the panel.

## Proposal

**Daily Values ship as data.** A `DAILY_VALUES` map in `@pantry/core`, keyed by
the FDC nutrient ids already in use, holding the FDA 2016 adult reference
amounts (total fat 78 g, saturated fat 20 g, cholesterol 300 mg, sodium
2,300 mg, total carbohydrate 275 g, fiber 28 g, added sugars 50 g, vitamin D
20 mcg, calcium 1,300 mg, iron 18 mg, potassium 4,700 mg). Trans fat, total
sugars and protein carry no Daily Value — as on the real label — and that
absence is expressed by their absence from the map, not by a branch.

**A pure label builder.** `nutritionFactsLabel(vector, { divisor, targets })`
returns ordered rows of `{ label, indent, amount | null, dvPercent | null,
targetPercent | null }`. Row order and indentation come from a static table, so
a recipe missing four nutrients still yields a panel of exactly the same shape
as one missing none. It lives in core and is unit-tested directly; the
percentage arithmetic is never exercised through the DOM.

**Unmeasured mandatory rows render, with an em-dash.** Trans fat, total sugars,
added sugars and vitamin D are mandatory lines the snapshot seed does not carry.
Dropping them would make the panel's shape drift recipe to recipe and stop it
looking like the label; printing `0` would be a lie. They render as `—`, and the
footnote says what that means. Backfilling those four nutrients into the Go
estimator and the snapshot seed is real work and belongs to its own item — the
panel is designed to absorb them with no change beyond the seed.

**Both denominators, because both are useful.** `%DV` is the fixed FDA
reference — the same for every user, which is exactly what makes it the
well-known number. `You` is the same amount measured against that user's BL-0038
target. The builder always computes both from one vector; which columns render
is a prop. That keeps a later "show Daily Value / my goals / both" preference a
UI change with no data or schema work behind it. The `You` column is omitted
entirely when the user has no active target touching these nutrients, which
returns the panel to the classic two-column layout that fits a phone.

**One component, two consumers.** `NutritionFactsPanel` in `apps/web` is
presentational and takes built rows. `RecipeNutrition` passes
`divisor = servings`; `PlanNutrition`'s day view passes the day's rollup with
`divisor = 1`, since a day is the period the Daily Value is defined against. The
**week** rollup keeps today's compact grid — a percentage of seven daily values
is not a thing anyone reads on a label — so `HEADLINE_NUTRIENTS` stays for it.

**A real table.** The panel is a `<table>` with scoped headers, not a div grid,
so assistive technology gets the row-and-column relationship the visual rules
are drawing. Styling comes from design tokens (BL-0025) so it works in both
themes.

**The honesty rules survive intact.**

- The 80 % coverage threshold still suppresses the whole panel. A
  familiar-looking, quasi-official label is precisely the artifact that must not
  appear over numbers we have told ourselves not to trust.
- A recipe with no yield (BL-0035 leaves it nullable) gets `divisor = 1` and an
  `Entire recipe` header, never a guessed serving.
- The header states `4 servings per recipe` and **omits the serving-size line**.
  A real panel names the serving ("1 cup"); we know a count, not a household
  measure, and will not invent one.
- The footnote carries three lines: the standard 2,000-calorie sentence, `— = not
  estimated`, and an explicit statement that this is estimated from ingredients
  and is not a regulated label.

## Testing

- Unit tests on the builder: DV arithmetic, rounding, missing nutrient → `null`
  amount, protein and trans fat correctly carrying no `dvPercent`, `targetPercent`
  present only where a target exists, row order and indentation stable across
  sparse vectors.
- Component tests for column collapse (no targets → two columns) and for the
  coverage threshold suppressing the panel.
- E2E pins nutrition copy verbatim; the footnote and header strings introduced
  here need to land in those specs in the same changeset.

## Alternatives considered

- **Keep the current grid, append a `%DV` figure under each value.** A
  substantially smaller change that preserves the responsive layout. Rejected
  because it forfeits the thing being asked for: recognizability comes from the
  panel's *shape* — the rules, the indentation, the right-hand column — not from
  the presence of a percentage.
- **Omit rows we cannot fill.** Every printed number would be real and the panel
  shorter. Rejected because the layout would then differ recipe to recipe, which
  is the specific way a label stops reading as a label.
- **Backfill trans fat, total sugars, added sugars and vitamin D first.** The
  honest maximal version, and worth doing — but it is estimator and seed work
  (`internal/nutrition/snapshot.json`, `compute.go`, `resolver.go`), not view
  work, and it would hold a presentation improvement hostage to a data-sourcing
  task. Filed separately; the em-dash rows become real numbers the day it lands.
- **Compute `%DV` against the user's BL-0038 targets instead of the FDA
  reference.** More personally useful, but two users would then see different
  percentages for the same recipe and the column would no longer be the standard
  number anyone recognizes. Showing both columns preserves the recognizable
  figure and adds the personal one beside it.
- **Put the panel on the week rollup too.** Rejected: `%DV` of a week is either
  a 700 %-scale number that reads as alarm, or a silent division by seven that
  misrepresents a total as an average.
