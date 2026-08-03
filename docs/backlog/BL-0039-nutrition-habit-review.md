---
id: BL-0039
title: Nutrition habit review — eating history and retrospective
status: done
area: nutrition
effort: M
related_specs: [2026-08-03-nutrition-system-design.md]
created: 2026-08-03
---

## Context

Targets (BL-0038) answer "am I on track *this* week?" Habit review answers "how
have I been eating?" — trends over weeks, how often goals were met, which
nutrients drift.

The obstacle is that **nothing records what was actually eaten.** The plan says
what was scheduled; the grocery list says what was bought. Neither is
consumption. BL-0028 (pantry cook-decrement) introduces "mark cooked", which is
the event this needs — but it is unbuilt, and this feature should not wait for
it.

Depends on **BL-0037**; strengthened by **BL-0028**.

## Proposal

- Convex table `nutritionLog` — `{userId, date, recipeId, servings, source,
  snapshot}`, indexed by user and date, where `source ∈ {planned, cooked,
  manual}`.
- **`snapshot` denormalizes the nutrient vector at log time.** FDC data is
  refreshed and mappings get corrected; without a snapshot, a fix applied today
  would silently rewrite what the user ate last month. History has to be stable
  even when the underlying food data is not.
- Rows are written from the plan as `planned`. When BL-0028 lands, "mark cooked"
  upgrades the same row to `cooked` — no migration, no second table.
- **The review surface states which signal it is showing.** "Based on your plan"
  before BL-0028, "based on what you cooked" after. Useful immediately, more
  accurate later, never silently overclaiming.
- Retrospective view: per-nutrient trend over a chosen window, goal-met rate
  against `nutritionTargets`, and days excluded for insufficient coverage —
  excluded, not counted as zero.

## Alternatives considered

- **Blocking on BL-0028.** Cleanest data, but it strands the feature behind an
  unscheduled pantry item, and planned-eating trends are genuinely useful for
  someone who cooks most of what they plan.
- **Computing history on the fly from plan rows.** No new table, but plan rows
  are mutable and get cleared between weeks, so history would be lossy and would
  shift under recipe edits — the exact problem `snapshot` exists to prevent.
- **A general food diary** ("log anything you ate"). The obvious ask, and where
  MyFitnessPal-style products live, but it is a large surface with its own
  search, barcode, and portion problems — and it fights the anti-friction
  principle in the UX plan. The `manual` source keeps the door open without
  committing to it now.
- **Storing history in Postgres.** It is time-series-ish and would suit a
  relational store, but it is user data and wants reactivity; keeping it in
  Convex holds the declared split.

## Delivered

Shipped as `nutritionLog` (Convex), `habitReview` (`@pantry/core`), and the
`/history` route. `snapshot` stores the vector for one whole recipe yield plus
its coverage; the row's `servings` carries the quantity, so BL-0028's "mark
cooked" upgrades a row with a single patch and no re-estimation. Plan syncs
never overwrite or delete a `cooked` or `manual` row.

## Follow-up: goal-met rate

The goal-met rate in the proposal above is **not** in this increment.
`nutritionTargets` belongs to BL-0038, which had not landed when this shipped,
and defining a competing targets table would have cost more than it bought.

Everything it needs is in place: `NutrientTrend.points` already carries one
value per counted day, so the rate is the share of *included* days meeting each
target. The one rule to preserve is that excluded days stay out of both the
numerator and the denominator — counting a day of missing data as a missed goal
is the same under-reporting failure this feature is built to avoid.
