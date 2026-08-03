---
id: BL-0024
title: Extract headless packages/core (planner, grocery list, import review)
status: in-progress
area: infra
effort: M
related_specs: [2026-07-18-mobile-client-design.md]
created: 2026-07-18
---

## Context

Domain logic currently lives inline in React components:

- `apps/web/src/components/WeekPlan.tsx` — day bucketing
  (`items.filter(i => i.weekday === day)`), the unscheduled rail, servings
  clamping (`Math.max(0.25, mult - 0.5)`), all inline in JSX.
- `apps/web/src/components/GroceryList.tsx` — aisle grouping by scanning
  consecutive rows.
- The import-review and edit-dialog flows (BL-0020) are about to grow more of
  the same.

This is hard to unit-test without rendering, and it is the single largest
blocker to a second client (see `2026-07-18-mobile-client-design.md`). It is
cheapest to fix now, while BL-0018/0019/0020 are still in flight, rather than
after they land and the logic has spread further.

## Proposal

Add `packages/core`: headless React hooks plus pure functions, no DOM and no
styling. Move planner bucketing/clamping, aisle grouping, and import-review
state into it, and have `apps/web` components consume it for presentation only.

`apps/web/src/lib/formatQuantity.ts`, `optimistic.ts`, and `useAsyncAction.ts`
are already portable and are natural early residents.

Establish the rule that domain logic belongs in `packages/core` or in Go, never
in a component — ideally enforced by a lint rule rather than convention alone.

## Alternatives considered

- **Leave it and extract later, only if mobile happens.** Rejected: the volume
  of logic in components grows with every in-flight backlog item, so the cost
  only rises. The extraction also has standalone value — this logic is currently
  untestable without rendering.
- **Extract into `packages/types`.** Wrong home; that package is deliberately
  dependency-free interfaces, and hooks would give it a React dependency.
