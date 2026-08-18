# What limits e2e parallelism (BL-0070)

`apps/web/playwright.config.ts` used to pin the browser suite to one worker with
this comment:

```ts
// The full loop mutates shared per-deployment state, so keep it serial.
fullyParallel: false,
workers: 1,
```

That is an assertion nobody could check, and it turned out to be wrong about the
cause. This document is the evidence behind the number that replaced it, so the
next person to touch it can re-run the experiment instead of re-guessing.

## What is actually shared

Less than "per-deployment state" suggests. Every spec registers its own account
(`signUp()` mints `e2e-<timestamp>-<rand>@example.test`) and `uniqueSuffix()`
namespaces recipe titles, so everything user-scoped — recipes, basket, plan,
pantry, interaction log, grocery list — is already isolated per spec.

What genuinely is shared:

| Shared thing | Written by specs? | Risk |
| --- | --- | --- |
| The seeded catalog (owned by the `catalog` sentinel user) | No — read-only | No collision, but it is *ranked* alongside the caller's own recipes — BL-0074 |
| Convex Auth tables (`users`, `authAccounts`, sessions) | Yes, one row per spec | Contention, not collision |
| One self-hosted Convex backend's CPU | — | The real limit |
| Postgres + recipe-service | — | Shared with the above |
| Host port 5173 (Vite) and 3210/3211 (Convex) | — | Collides across checkouts |

## What we found

**The pin was not protecting against cross-spec data collision.** In roughly 40
local runs and 27 CI runs we never once saw a spec observe another spec's data.
The per-spec account plus `uniqueSuffix()` is sufficient isolation, and none of
the "genuine cross-spec data collision" failures that would justify building
per-worker deployments appeared.

**What the pin was actually doing was hiding latent races in the specs.** At
`workers: 1`, on a fast local machine, the suite failed on roughly three runs in
five — with a *different* set of specs each time. CI stayed green throughout,
which is why nobody had noticed: the races are timing-sensitive and CI's runner
happened to lose them less often.

Three distinct defects, all fixed in this change:

1. **Navigation that did not wait for the destination.** Clicking a nav link only
   schedules the route change; TanStack Router flips the link's active state as
   soon as the location changes, but the route components are lazily loaded, so
   the *previous* route can still be mounted. A failure snapshot caught the Plan
   link already `[active]` while the DOM was still `/recipes`.

2. **Locators ambiguous on the page they ran against.** `/recipes` renders a
   recipe title in both `<RecipeList>` and the "For you" panel; `/plan` renders
   it in both the "Not yet planned" rail and a day column; `/list` grows a second
   listitem naming the same ingredient once `<LeftoverProposals>` appears.

   These two compound, and the compound is what made it violent. A locator that
   matches **two** elements is a Playwright *strict-mode violation*, which is a
   hard error it does **not** retry. So a spec that arrived early at a page did
   not wait — it died. Scoping the locator changes the failure from "matched two,
   abort" to "matched none, keep polling", which self-heals.

3. **Full page loads that cancelled in-flight Convex writes.** `page.goto()` and
   `page.reload()` drop the websocket. Four `goto` calls sat directly after a
   mutation. Worse, the two "does it survive a reload" specs asserted on
   optimistically-updated controls — `groceryList.toggleItem` and
   `prepTasks.setDone` both carry `.withOptimisticUpdate(...)`, so the tick
   renders before the server has seen anything, and one spec carried a comment
   claiming the exact opposite. There was no observable "the backend agreed"
   signal, so we added one: `useAsyncAction` already tracks `pending`, and it is
   now surfaced as `aria-busy` on the two cards.

**Only after those were fixed was the worker question answerable at all.**

## The measurement

CI, `ubuntu-latest` (4 vCPU, public-repo runner), fresh compose stack per run,
`--retries=0` so nothing is absorbed. Playwright's own reported duration, which
excludes the stack setup:

| Arm | Runs | Green | Playwright duration (mean) |
| --- | --- | --- | --- |
| `--workers=1` (the old pin) | 12 | 9 | ~37s |
| `--workers=2` | 9 | 8 | ~29s |
| `--workers=4` | 9 | 8 | ~29s |
| `--workers=4 --fully-parallel` | 15 | 13 | ~27s |

45 runs in total. Two things fall out of it.

**Parallelism does not cost reliability.** The serial arm was the *least* green
of the four. The residual failures are not merely similar across arms, they are
the same three assertions:

- `locator.check: Clicking the checkbox did not change its state` (home dashboard)
- the suggested meal never appearing in the Monday column (suggest-week)
- the aisle heading never appearing (grocery list UX)

All three occur at one worker and at four. Whatever they are, worker count is not
the variable, so serialising was buying nothing. They are separate latent bugs,
tracked in their own item rather than fixed here. In practice the per-PR gate
absorbs them, because it runs with `retries: 1`; these numbers were taken with
`--retries=0` deliberately, so that nothing was hidden.

> **Since resolved (BL-0074), and not by the cause guessed at here.** This
> paragraph originally called all three "writes that occasionally do not land".
> One of them is: the aisle heading goes missing because
> `recipes.generateGroceryList` is an *action* that reads the basket
> server-side, and the only barriers the spec had — the "Not yet planned" rail
> row and the Generate button being enabled — are both satisfied by
> `addToBasketOptimistic` and by `canGenerateList(items)`, neither of which
> involves the server. It aggregated an empty basket and stored an empty list,
> permanently. The other two are not writes at all: the suggest-week failure is
> the ranker's documented id tiebreak choosing a seeded catalog recipe over the
> spec's own (a consequence of BL-0051 that the spec did not know about), and
> the home-dashboard one is a positional `getByRole("checkbox").first()`
> resolved before the list query had settled. See BL-0074.

**The benefit saturates at two workers.** 1 → 2 is worth ~8s; 2 → 4 is worth
nothing measurable. With `fullyParallel: false` the critical path is the longest
single spec file, and past two workers that file is what everything waits on.
Turning on `fullyParallel` splits within a file too and recovers about another
2s, which is not worth giving up the simpler within-file ordering for.

## The decision

`workers: 2`, `fullyParallel: false`.

The pin was stale, but "delete two lines" was not quite the whole answer: the
suite could not have been trusted at *any* worker count until the latent races
above were fixed, and it was already failing three runs in five locally at
`workers: 1`. With those fixed, the worker count became a straight
speed-vs-contention question, and the measurement says two.

Four was measured and is not faster, so there is no need to re-test it. Do not
raise this number expecting a win — the browsers, Vite and the compose stack
share the runner's four cores, and the first symptom of oversubscribing them is
Convex functions breaching their 1s execution limit, which surfaces as sign-ups
failing rather than as anything that names CPU.

What we did **not** need to build: per-worker Convex deployments, or the
provisioning endpoint that hands each test a fresh backend (the Bluesky shape
described in `docs/mobile-testing-strategy.md`). Those are justified by genuine
cross-spec data collision, and there is no evidence of any. If mobile e2e later
drives the same deployment concurrently with the browser suite, re-run this
experiment before assuming that conclusion still holds.

## The thing worth knowing next

**The worker count is not the big lever any more.** The whole e2e CI job runs
~140s, and Playwright is only ~27-37s of it. The rest is checkout, `pnpm
install`, downloading Chromium, building the recipe-service image, `compose up`,
seeding, generating an admin key and pushing Convex functions. Going from one
worker to four saves ~10s on a ~140s job. Anyone chasing e2e wall clock should
attack setup, not concurrency.

## Two traps that cost real time here

**A stale Vite dev server on port 5173 is silently adopted.**
`reuseExistingServer` is on outside CI, so if another checkout left a dev server
running, Playwright uses it and the suite reports on *that* server's code. Both
false passes and false failures are reachable. `E2E_PORT` now overrides the port
in both `playwright.config.ts` and `scripts/e2e.sh` (SITE_URL has to track it, or
Convex Auth rejects every sign-up).

**A long-lived local deployment degrades in a way CI never sees.** CI gets a
fresh stack every run. A local stack left up across a working session accumulated
531 e2e users and 834 recipes, and Convex functions started failing with
`Function execution timed out (maximum duration: 1s)` even at one worker. If
local e2e suddenly starts failing on sign-up, check how much test data has piled
up before believing anything else.

## Reproducing

```bash
pnpm test:e2e                      # default worker count
pnpm test:e2e --workers=1 --retries=0
E2E_PORT=5174 pnpm test:e2e        # when something squats 5173
```

Trust CI over a laptop for anything timing-related: a dev machine shares CPU with
whatever else is running, and the browsers, Vite and the whole compose stack are
all competing for it.
