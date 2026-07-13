---
id: BL-0018
title: Meal planner — basket becomes a dinner-first week plan
status: in-progress
area: meal-planning
effort: L
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

There is no meal planner yet. The current Convex basket is an unordered set of recipe
references that feeds aggregation. The research shows a near-term planner is that same set
with a thin "week" dimension — and that these apps fail from admin friction, so the design
must be deliberately low-effort.

## Proposal

- **Basket becomes the plan.** Add per-entry fields: `plannedDate` (or weekday index + week
  id), `slot` (default `"dinner"`), `servingsMultiplier` (default from household size),
  `type` (`"meal"` | `"leftover"`). Convex still stores recipe-id references only.
- **Dinner-first 7-day view.** Grid + recipe rail on desktop/tablet; **vertical agenda** on
  phone. Empty non-dinner slots are a subtle "+ add", not demanding blanks.
- **Tap "Add to day" / "Move to…"** near-term (drag-and-drop is a vision fast-follow). "Add
  to plan" is a first-class action on every recipe surface.
- **Servings stepper** per card flows the multiplier into aggregation quantities.
- **Leftovers** occupy a slot but contribute nothing to the grocery list.
- **"Generate grocery list"** over the visible week → existing Go aggregation → live Convex
  list. **Non-destructive diff-merge:** preserve already-checked items, merge new, flag
  removed. (This regeneration rule is decision #2 in the UX plan — confirm before building.)

## Alternatives considered

- **Separate planner subsystem** — unnecessary; the basket + a week dimension reuses the
  whole aggregation pipeline.
- **Full breakfast/lunch/dinner grid** — multiplies empty cells the user feels obliged to
  fill; dinner-first with optional slots matches real behavior.
- **Drag-and-drop v1** — most-praised feature but desktop-first and expensive on touch;
  defer to the vision layer after tap-based add/move proves out.

## Progress

- **2026-07-12 — Increment 1 (shipped):** dinner-first week-plan data model +
  assign/move UI. Added optional `weekday` (0=Mon..6=Sun) and `slot` to the
  `basket` table (backward compatible; aggregation unchanged), `basket.schedule`
  / `basket.unschedule` mutations, and a responsive `WeekPlan` (`/plan`) —
  7-column grid on desktop / stacked agenda on phone, an unscheduled rail with a
  day picker, and the existing "Generate grocery list".
- **Deferred (next increments):** `servingsMultiplier` flowing into aggregation
  (needs recipe-service quantity scaling), `type: leftover`, non-dinner slots,
  and the **non-destructive diff-merge regeneration** (UX-plan decision #2 —
  flagged *confirm before building*; today's generate still replaces the list).
