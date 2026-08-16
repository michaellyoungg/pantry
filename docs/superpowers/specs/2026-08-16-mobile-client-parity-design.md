# Mobile client — parity plan (Android + iOS)

**Date:** 2026-08-16
**Status:** design approved; implementation decomposed into BL-0053…BL-0069
**Supersedes:** [`2026-07-18-mobile-client-design.md`](2026-07-18-mobile-client-design.md)
**Related:** [`2026-07-12-full-app-ux-plan.md`](2026-07-12-full-app-ux-plan.md)

## Summary

Ship a native Expo client for **both iOS and Android**, private first
(TestFlight + Play internal), reaching **full parity with the web app**
incrementally. Roughly **10–12 weeks** of focused solo work to the first private
build with the in-store loop, **22–27.5 weeks** to parity, **24–30 weeks** to a
public launch on both stores.

The 2026-07-18 design settled the architecture and remains correct. This document
re-plans it against a codebase that roughly tripled in the intervening month,
corrects three claims in that document that no longer hold, and decomposes the
work into backlog items.

## What changed since 2026-07-18

| | Then | Now |
|---|---|---|
| Routes | 5 | 11 |
| Web view layer | ~2,000 LOC | ~7,555 LOC (~6,000 in components) |
| `packages/core` | did not exist | ~2,673 LOC, 15 pure modules |
| Phase 0 prep | 0/5 done | 3/5 done (BL-0024, BL-0025, BL-0026) |
| Hard prerequisites | BL-0006, BL-0007 | BL-0006 only (see below) |

The headless discipline held. `packages/core` now carries planner bucketing,
aisle grouping, all five nutrition modules, habit review, week suggestion,
recipe drafting, and calendar maths — pure, DOM-free, and mechanically enforced
by `biome.json` overrides plus a DOM-less `tsconfig`. This is the single biggest
reason the estimate below is not far larger.

## Corrections to the 2026-07-18 design

**1. BL-0007 (OpenAPI codegen) is not a mobile prerequisite.**
That document listed it because "a second consumer multiplies the drift
surface." But its own rule 2 states Convex is the only client entry point, so a
native client adds *zero* new Go consumers — it speaks to Convex, and
`@pantry/types` is already shared TypeScript. BL-0007 remains worth doing on its
own merits. It is off the mobile critical path (~1 week).

**2. The top risk is closed.**
That document said the regeneration-preserves-check-off path "should be proven
with a test before the Phase 2 estimate is trusted." It now is:
`packages/convex/convex/groceryList.test.ts:103` proves checked state survives
regeneration for surviving lines, and `:206` proves a checked line the plan no
longer wants is flagged rather than deleted.

**3. Rule 6 ("grocery check-off stays commutative") is weaker than written, and
the offline design must account for it.**
BL-0021 and BL-0032 landed after that document. `toggleItem`
(`packages/convex/convex/groceryList.ts:176`) is no longer a boolean patch:

- It is keyed on `v.id("groceryList")` — a Convex **document id**, not the
  `item|unit|aisle` composite the rule claims. Regeneration deletes and
  re-inserts rows, so a queued offline check-off holding a stale `_id` fails
  with `Not found` on replay.
- Checking off writes **pantry inflow** (`upsertFromCheckoff`). Unchecking
  removes the auto row *and* clears `leftoverDecision`. It has cross-table side
  effects.

The consequence is a specific offline design, given in §5.

## Decisions

Carried forward from 2026-07-18 unless marked new.

| Question | Decision |
|---|---|
| What kind of client? | **Native (Expo / React Native)** sharing the Convex backend. Not a PWA, not a Capacitor shell. |
| How much code is shared? | **Headless React only.** Hooks, state, and pure functions shared; view layers written separately per platform. |
| Scope? | **Full parity**, reached route by route. *(new — was "in-store subset")* |
| Platforms? | **iOS and Android from the start**, one RN codebase. *(new)* |
| Distribution? | **Private first** (TestFlight + Play internal); public store launch is a separate later increment. *(new)* |
| Offline? | **Durable local cache for the grocery list only.** Collapse-and-replay reconciliation (§5). |
| Backend? | BL-0006 runs as an **independent track**; this plan assumes it lands before device testing. *(new)* |

### The assumption that makes "parity, piecemeal" coherent

The native app lags the web app for months. That is not a functionality
regression, because **the web app is already mobile-shaped** — `Nav.tsx` renders
a real bottom tab bar under `sm:hidden`. Routes the native client has not
reached are still reachable on the phone's browser. The product never loses a
capability; the native client is strictly additive as it grows.

If the web app ever stops being usable on a phone, this assumption breaks and
the parity schedule becomes a functionality cliff.

## Architecture

`apps/mobile` — an Expo app, peer to `apps/web`, not a package. It consumes
exactly what web consumes:

| Package | Role |
|---|---|
| `@pantry/types` | dependency-free interfaces |
| `@pantry/core` | pure domain logic |
| `@pantry/core/react` | headless hooks |
| `@pantry/core/data` | **new** — one hook per screen (§4) |
| `@pantry/convex` | generated function API |
| `@pantry/design-tokens` | palette, and after BL-0053 the rest of the scale |

No view code is shared, in either direction.

### Rules carried forward

The 2026-07-18 rules 1–5 stand unchanged: headless-first discipline; Convex is
the only client entry point; design tokens are data; NativeWind over a separate
styling system; navigation never leaks into shared code. Rule 6 is amended by
§5. Rule 7 (replace emoji icons) is still unaddressed and becomes BL-0054.

## 4. The `@pantry/core/data` layer

45 of 62 non-test `.tsx` files call `useQuery`/`useMutation`/`useAction`
directly — **56 call sites**. Under two view layers that wiring is authored
twice and then drifts silently.

Each screen instead gets one headless hook — `useGroceryList()`,
`usePlanWeek()` — returning data, actions, and derived state, so each platform's
view is pure presentation.

This decides whether the permanent per-feature tax is ~2× or closer to ~1.3×,
and it is the highest-leverage item in the plan. It is also incremental and
web-positive: port a route, push its wiring down, have web adopt the same hook,
both suites go green. No big-bang refactor, and no mobile commitment required to
start.

## 5. Offline — grocery list only

Persist the list and pending check-offs; reconcile on reconnect. Given the
`toggleItem` semantics in §3:

**Replay the final intended state per line, not the event log.** Collapse the
offline queue to one desired `checked` value per `item|unit|aisle` composite
key, re-resolve that key to the current document id at replay time, and issue
one `toggleItem` per line.

This is idempotent and order-independent, and it gets the pantry side effects
right — `upsertFromCheckoff` and `removeAutoRow` are themselves upsert/remove
semantics, so the final state converges. A naive mutation queue replaying every
tap in order would corrupt the don't-rebuy signal BL-0021 built.

**Unresolvable case:** a line checked offline that the server hard-deleted
during a regeneration it performed before ever hearing about the check-off.
Replay finds no row. Silently dropping it loses a real purchase *and* its pantry
inflow, so surface it as a small conflict prompt instead.

## 6. Testing

Researched independently and in more depth in
[`../../mobile-testing-strategy.md`](../../mobile-testing-strategy.md) (PR #149,
open at time of writing). That document's one unanswered "gating question" —
React Native/Expo versus a Capacitor/PWA wrapper — **is answered here: native
Expo.** Its findings therefore apply in full.

| Layer | Tool | Note |
|---|---|---|
| Shared logic | Vitest | unchanged; carries the real test weight |
| Native views | **`jest-expo` + React Native Testing Library** | a deliberate divergence — the repo is otherwise Vitest-only, but Vitest cannot drive RN. Scope the second runner to `apps/mobile`. |
| Device E2E | **Maestro** | in-store loop only; **nightly, not a merge gate** |

Mobile typecheck and unit tests join the normal per-PR CI gate. Maestro and EAS
builds run out of band — the same posture the Playwright suite already has, and
the same one Bluesky settled on after replacing Detox with Maestro in 2024.

Three mechanisms from that research shape work elsewhere in this plan:

1. **`testID` is the selector contract, and it must precede the screens.** React
   Native has no DOM and no ARIA roles, so the role- and text-based locators the
   Playwright suite uses **do not port**. Establishing testID conventions is part
   of the foundation (BL-0056), not something retrofitted once screens exist.
2. **A fresh backend per flow.** `playwright.config.ts` currently runs
   `workers: 1` because every spec shares one Convex deployment. Building
   per-flow ephemeral backends for mobile e2e fixes that constraint for the web
   suite too — a rare case where mobile work pays the web back directly.
3. **Build-time module swap** (Metro's `RN_SRC_EXT`) for things a test harness
   cannot exercise, such as push notifications. There is no Playwright analogue,
   so this is new capability rather than a port.

## 7. Release

EAS Build + EAS Submit. TestFlight internal testing and the Play internal track
require no store review, so private distribution is fast. Apple Developer
Program is $99/yr; Play is $25 once.

Two items gate the **public** phase and should start early because they are
calendar-bound:

- **In-app account deletion does not exist anywhere in the codebase.** Apple
  guideline 5.1.1(v) requires it for any app with accounts. This is a real
  feature — cascade delete across ~10 Convex tables plus the Postgres-owned
  recipes — not a checkbox. It is independently correct to have. → BL-0068.
- **Google Play closed-testing gate.** A new personal developer account must run
  a closed test with 12+ testers for 14 days before production access is
  granted.

## Estimate

Focused solo work, assuming BL-0006 has landed on its own track.

| Phase | Work | Estimate |
|---|---|---|
| **0 remainder** | Tokens beyond color; shared icon set; `@pantry/core/data` scaffold + 2 pilot screens | **~2 wk** |
| **1 foundation** | Expo, Metro↔pnpm, Expo Router tabs, Convex + SecureStore auth, NativeWind, CI | **2–3 wk** |
| **2 in-store** | Grocery views (2 wk) · offline collapse-and-replay (2–2.5 wk) · pantry (1 wk) | **4.5–5.5 wk** |
| **3 private ship** | EAS, TestFlight, Play internal, icons/splash, env separation | **1–1.5 wk** |
| | **→ first private build, in-store loop, both platforms** | **~10–12 wk** |
| **4 parity** | Cooking 1.5–2 · Home 1–1.5 · Recipes 2–2.5 · Plan 2–2.5 · Nutrition 2.5–3.5 · Settings 1.5–2 · History 1–1.5 | **12–15.5 wk** |
| | **→ parity, both platforms, private** | **~22–27.5 wk** |
| **5 public** | Account deletion, privacy manifests, data safety, listings, assets | **+1.5–2.5 wk** + review latency |
| | **→ public parity, both platforms** | **~24–30 wk** |

Phase 0 pays for itself regardless of any mobile commitment. Phase 4
parallelizes well — independent routes, independent files — which suits how this
repo is actually worked. **Phase 1 and the offline item are strictly serial and
are where overruns will come from.**

Android's marginal cost is folded into every line (~15–20% on view work, ~0.5–1
week of release plumbing) rather than broken out, because every phase is one RN
codebase.

**The ongoing tax still matters more than the one-time cost**, and at parity it
is larger than the 2026-07-18 document contemplated: every new feature needs two
view implementations, permanently. `@pantry/core/data` is the mitigation, not a
cure.

## Risks

- **Metro plus pnpm workspaces**, still the most likely place to overrun. Sharper
  now than in July: workspace packages resolve through `dist/`, and this repo has
  already been bitten twice by stale-`dist` failures that produce runtime errors
  with no type error. Point Metro at package *source* via resolver config rather
  than depending on `turbo build` ordering.
- **The offline reconciliation** is the riskiest feature. §5 gives a design that
  is correct by construction, but the pantry side effects mean a wrong
  implementation corrupts user data rather than merely losing a tap.
- **`expo-secure-store` value size.** iOS warns above 2048 bytes per value;
  a JWT plus refresh token may approach it. Verify early in Phase 1 — the
  fallback is splitting the keys.
- **Headless drift.** Domain logic re-accumulating in components is now a
  two-platform problem. The `biome.json` overrides that guard `packages/core`
  should be extended to guard `apps/mobile` the same way.
- **Parity is a moving target.** The web app gained six routes in one month. If
  that pace continues, the native client is chasing a receding line, and Phase 4
  never closes. Consider freezing web feature work during Phase 4, or accepting
  a permanent lag on low-value-on-phone routes (History, Settings).

## Alternatives considered

- **Hybrid: Expo shell with a WebView for un-ported routes.** Parity from the
  first build with no cutover, and the native path stays open. Rejected in favour
  of view quality and a single coherent navigation model; the auth bridge between
  `expo-secure-store` and the WebView was also an unproven unknown.
- **Universal app (React Native Web + Expo Router).** One view layer for all
  three platforms, which would eliminate the permanent two-view tax outright —
  the dominant lifetime cost at parity scope. Rejected because it is a rewrite of
  a working web app's view layer (~6,000 LOC), costs Tailwind-as-CSS and
  TanStack Router, and puts the web app in flux for months.
- **Capacitor shell.** Parity on day one for almost no work, but it welds the
  native escape hatch shut — the in-store experience never improves, which is the
  entire point.
- **Offline-first across the whole app.** Unchanged from 2026-07-18: fights
  Convex's model rather than using it.

## Backlog decomposition

| Phase | Items |
|---|---|
| 0 remainder | BL-0053, BL-0054, BL-0055 |
| 1 foundation | BL-0056 |
| 2 in-store | BL-0057, BL-0058, BL-0059 |
| 3 private ship | BL-0060 |
| 4 parity | BL-0061 … BL-0067 |
| 5 public | BL-0068, BL-0069 |

External dependency, tracked separately: **BL-0006** (deployment) — a hard
prerequisite for any on-device testing.
