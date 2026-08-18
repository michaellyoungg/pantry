---
id: BL-0074
title: Three e2e assertions that fail when a write quietly does not land
status: done
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

## What they turned out to be

The proposal's guess — one shape, a write that quietly does not land — held for
one of the three. The other two were something else, and saying so is the point
of writing this down.

**The aisle heading (grocery-list-ux) is the write one, and it is worse than
late: it is a permanently empty list.** `recipes.generateGroceryList` is an
*action*. It reads the basket with `ctx.runQuery(api.basket.list)` **on the
server**, aggregates whatever is committed at that instant, and never runs
again. What `scheduleAndGenerate` could wait on before pressing Generate was the
"Not yet planned" rail row and the Generate button being enabled — and both are
pure client state: the rail row is `addToBasketOptimistic`, applied the moment
"Add to basket" is pressed, and the button is `canGenerateList(items)`, which is
`items.length > 0` over that same optimistic basket and says nothing about days.
A `basket.add` still in flight therefore produced an empty aggregation,
`mergeGroceryList` stored an empty list, and no aisle section was ever coming.
Raising the timeout could not have helped, which is consistent with the failure
being "never appears" rather than "appears late".

The barrier is the `Remove <title> from <day>` control. `basket.schedule` has no
optimistic update and is a silent no-op unless the row it patches already
exists, so that control rendering proves both writes landed.
`catalog.spec.ts`, `core-loop.spec.ts` and `aggregation-and-isolation.spec.ts`
all reach the same action through the same helper and had the same hole.

**The Monday column (suggest-week) is not a write at all — it is a tiebreak
lottery the spec did not know it had entered.** The spec's docstring claimed
independence from the shared catalog because it was empty in e2e. BL-0051 seeded
it, and `recommendPantry` ranks the caller's recipes *together with* all 57
catalog rows. Against an empty pantry with no preferences every candidate scores
identically, so ranking falls through to its documented tiebreak — recipe id
ascending — and `suggestWeek` then takes the best remaining candidate for
Monday. Catalog ids are `cat-…`; a user recipe's is a random 32-char hex string,
which sorts after them about one time in five, so with two recipes in play
roughly one run in twenty-three put a catalog dinner on Monday and
`getByText(/<suffix>/)` correctly found nothing. The spec now reads the dinner
the proposal offered for Monday off the card and asserts *that* one arrives,
which is the promise the feature makes.

**The checkbox (home-dashboard) was still a locator resolved too early.**
BL-0070 scoped it to the grocery card, but `getByRole("checkbox").first()` is
still positional, and the card becomes visible before `getGroceryList` resolves
— so the tick landed on the first frame the list rendered, the same frame that
inserts the row. The line is now named through the shared selector contract
(BL-0071), and the tick is followed by aria-busy settling plus a retrying
`toBeChecked`. That pair is a strictly stronger claim than `check()` was making:
`check()` reads the control's state once, immediately, and never asked whether
the server agreed.

**Not confirmed against CI.** The item asks for the BL-0070 matrix to be re-run
to show the rate moved, and that has not been done — the e2e stack binds fixed
host ports (3210/3211, 8090, 5433, 5173) and another checkout's stack was live,
so running it locally would have torn down someone else's. The diagnoses above
are from the code and are individually checkable; the rate is not.

**Where the `aria-busy` signal was extended.** Only to the suggest-my-week card,
where `apply.pending` covers the add+schedule pair per pick. The week plan did
not need it: `Remove <title> from <day>` already states the same fact about the
scheduling write, and states it about the *state* rather than about the absence
of in-flight work.

## Alternatives considered

- **Leave it to `retries: 1`.** What we do today, and it works, but a retry
  budget spent on a known bug is not available for a real one, and the rate is
  high enough that a second concurrent flake would go red.
- **Raise timeouts.** Would hide a lost write rather than fix it, and the
  failures are not uniformly timeouts — the checkbox one reverts promptly.
