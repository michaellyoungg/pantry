---
id: BL-0012
title: Web UI interaction polish (optimistic updates + error surfacing)
status: proposed
area: web
effort: M
related_specs: [2026-06-29-web-app.md]
created: 2026-06-30
---

## Context

Plan 2b shipped a deliberately-minimal functional UI. Two interaction rough
edges surfaced in review + the live browser smoke:

- **Grocery check-off flicker.** The checkbox is controlled (`checked={line.checked}`)
  with no optimistic update, so toggling visibly reverts for a beat until the
  Convex mutation round-trips. (Caught the e2e driver's strict `check()` out.)
- **Swallowed errors / no feedback.** `RecipeForm` submit, `Basket` Generate, and
  `GroceryList` toggle all drop their promise rejections. If recipe-service or
  Convex is down, the user sees nothing — a spinner just stops.

## Proposal

- Add Convex optimistic updates (`useMutation(...).withOptimisticUpdate`) for
  `toggleItem` (and basket add/remove) so the UI responds instantly.
- Surface errors: a small inline error string per panel on rejected
  mutations/actions/fetches, instead of `console.error`/silent.
- The `Catalog` panel (BL-0002) fetches via `listCatalog()` and shows the same
  "No catalog recipes yet." for loading, empty, and fetch-failure (the rejection
  is only `console.error`'d). Distinguish loading / empty / backend-down there
  when this lands.

## Alternatives considered

- Leave as-is — fine for a single-user skeleton, but the flicker + silent
  failures are the first things a real user trips on.
