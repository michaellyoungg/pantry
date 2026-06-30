---
id: BL-0014
title: End-to-end browser tests (Playwright)
status: proposed
area: infra
effort: M
related_specs: [2026-06-29-web-app.md]
created: 2026-06-30
---

## Context

Plan 2b's loop was verified once with an ad-hoc Playwright driver against the
live stack (created recipes → basket → generate → `3 cloves garlic` → check-off,
reload-persistent, zero console/request errors). That harness was throwaway. A
committed e2e test would catch regressions in the cross-service browser flow that
unit tests + typecheck can't (CORS, Convex reactivity, the controlled-checkbox
behavior).

## Proposal

- Add `@playwright/test` to `apps/web` (dev) with a spec that drives the full loop
  against a compose-up stack, using unique-per-run recipe titles and a
  reset-basket/grocery fixture for isolation.
- Wire it as a separate `test:e2e` script (NOT the default `test`, which stays
  unit-only/fast). Document the stack + `RECIPE_SERVICE_URL` prerequisites.

## Notes / gotchas learned

- The sandbox lacked chromium's OS libs; CI/dev needs `playwright install --with-deps`
  (or the equivalent libs: libnspr4, libnss3, libgbm1, libasound2).
- The grocery check-off needs click-then-poll (or an optimistic update, BL-0012)
  because the controlled checkbox briefly reverts pre-round-trip.
- Tests must isolate the shared `DEV_USER_ID` state (reset basket + grocery, unique
  recipe titles) until real auth (BL-0004) scopes per user.
