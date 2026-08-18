---
id: BL-0074
title: Three e2e assertions that fail when a write quietly does not land
status: in-progress
area: infra
effort: S
related_specs: [../e2e-parallelism.md]
created: 2026-08-16
---

## Context

BL-0070 measured the browser suite across 45 CI runs at one, two and four
workers with `--retries=0`, and found a residual per-run failure rate of roughly
10–25% that is **independent of worker count**. The same three assertions fail in
the serial arm and the parallel arm alike:

- `home-dashboard.spec.ts` — `locator.check: Clicking the checkbox did not
  change its state` on the grocery checkbox.
- `suggest-week.spec.ts` — the accepted suggestion never appears in the Monday
  column (`region "Monday" › getByText(/<suffix>/)`).
- `grocery-list-ux.spec.ts` — the aisle heading
  (`button /,\s*\d+ items? to buy$/`) never appears.

The per-PR gate runs with `retries: 1`, which absorbs a single flaky test, so
these are invisible in normal operation. They were deliberately not fixed in
BL-0070, which was about the worker pin; they are recorded here so they are not
lost.

Note what they are *not*: none is a cross-spec data collision. BL-0070 found no
evidence of one, and the isolation the specs already have (a fresh account per
spec, `uniqueSuffix()` on titles) held throughout.

The evidence, and the three race classes already fixed, are in
`docs/e2e-parallelism.md`.

## Proposal

All three have the same shape — an assertion about state that depends on a write
having landed, with nothing proving it did. BL-0070 established the pattern for
fixing that: `useAsyncAction` already tracks `pending`, which flips false only on
server acknowledgement, and surfacing it as `aria-busy` gives a spec something
real to wait for. `GroceryList` and `BeforeYouCook` do this now.

- Work out, per failure, whether the write is genuinely lost or merely late.
  "Clicking the checkbox did not change its state" is Playwright reporting that
  the control reverted, which for an optimistic mutation means the mutation
  rejected or never flushed — worth knowing which.
- Extend the `aria-busy` acknowledgement signal to the remaining surfaces that
  need it (the week plan / suggest-my-week card is the obvious next one).
- Re-run the BL-0070 matrix afterwards to confirm the rate actually moved. The
  harness is a short `workflow_dispatch` matrix over `pnpm test:e2e
  --workers=N --retries=0`; it is quick to recreate and deliberately not merged.

## Alternatives considered

- **Leave it to `retries: 1`.** What we do today, and it works, but a retry
  budget spent on a known bug is not available for a real one, and the rate is
  high enough that a second concurrent flake would go red.
- **Raise timeouts.** Would hide a lost write rather than fix it, and the
  failures are not uniformly timeouts — the checkbox one reverts promptly.
