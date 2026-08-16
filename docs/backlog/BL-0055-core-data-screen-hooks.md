---
id: BL-0055
title: "@pantry/core/data — push Convex wiring out of view components"
status: done
area: infra
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

45 of 62 non-test `.tsx` files in `apps/web/src` call `useQuery`, `useMutation`,
or `useAction` directly — **56 call sites**. Data fetching, mutation wiring,
loading and error handling, and optimistic updates all live in the view layer.

BL-0024 extracted the *pure* domain logic into `packages/core`, which is why the
mobile estimate is as small as it is. But it deliberately stopped short of the
Convex wiring, which is still component-resident.

Under the two-view-layer decision in
`2026-08-16-mobile-client-parity-design.md`, every one of those 56 call sites
gets authored a second time for React Native and then drifts from the web
version silently — the two clients would fetch different fields, handle errors
differently, and diverge in optimistic behaviour with nothing to catch it.

This is the difference between a ~2× permanent per-feature tax and something
closer to ~1.3×.

## Proposal

Add a `@pantry/core/data` entry point: one headless hook per screen —
`useGroceryList()`, `usePlanWeek()`, `usePantry()` — returning data, actions,
and derived state. Views become pure presentation.

Convex React hooks work unchanged in React Native, so these hooks are shared
verbatim; only rendering differs per platform.

Do it incrementally, never as a big-bang refactor: scaffold the entry point,
migrate two pilot screens (grocery list and pantry — the first two routes the
native client ports), and let each later route port carry its own migration.
Web adopts each hook as it lands, so both suites stay green throughout.

The existing `@pantry/core/react` hooks (`useAsyncAction`, `useAsyncData`,
`useRecipeDraft`) are the natural building blocks.

## Alternatives considered

- **Leave wiring in components and duplicate it per platform.** What the
  2026-07-18 design implicitly assumed. Rejected: 56 call sites duplicated with
  no mechanical guard against drift is the largest avoidable cost in the whole
  mobile plan.
- **Share view components via React Native Web instead.** Removes the
  duplication entirely, but is a rewrite of the web view layer — considered and
  rejected in the parity design.
- **Do all 11 routes up front.** Rejected: a large refactor touching 45 files at
  once conflicts with every open PR in a repo worked by parallel agents.
