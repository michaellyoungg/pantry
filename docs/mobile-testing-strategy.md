# Mobile testing strategy — research notes

Status: research / recommendation. No code committed. Written for whoever plans
the mobile client build.

We have Playwright driving the React web client. This asks what the equivalent
is for a mobile client, using [`bluesky-social/social-app`][bsky] as the
reference implementation — a production React Native app, cross-platform,
open source, and close enough in shape to be worth copying from.

[bsky]: https://github.com/bluesky-social/social-app

## TL;DR

- **Maestro** for mobile e2e. It is what Bluesky uses today, having replaced
  Detox in May 2024 ([#3983][bsky-maestro]). YAML flows, no native test-build
  wiring, one tool for iOS + Android.
- **Keep Playwright for web.** Maestro can drive browsers, but our web suite is
  eight mature specs and Playwright is better at the web. Two tools, one per
  platform, is the right answer.
- **jest-expo + @testing-library/react-native** for mobile component tests. This
  introduces a second test runner alongside vitest; scope it to `apps/mobile`.
- **The tool choice is the least important decision here.** The three things
  that actually determine whether mobile e2e is sustainable are backend
  isolation, e2e escape hatches in the app, and stable `testID`s. Sections
  below.

[bsky-maestro]: https://github.com/bluesky-social/social-app/pull/3983

## The question this opened with — now answered

This document originally led with an unanswered question: **React Native/Expo,
or a wrapper (Capacitor / PWA / web view) around the existing web app?** The
answer changes almost everything below it, because a wrapper is already covered
by Playwright and would need only a thin on-device smoke suite.

It is settled: **native Expo**, per the mobile client parity plan
([`superpowers/specs/2026-08-16-mobile-client-parity-design.md`](superpowers/specs/2026-08-16-mobile-client-parity-design.md),
BL-0056 *Expo app foundation*). Everything below applies in full.

## What Bluesky actually does

Read from the repo rather than from blog posts. Their layers:

| Layer | Tool | Where | When |
| --- | --- | --- | --- |
| Unit | Jest (`jest-expo/ios` preset) | `__tests__/lib` — 11 files, pure utils only | Per PR |
| Component | `@testing-library/react-native` | installed, barely used | Per PR |
| Typecheck | 3 tsconfigs: `.ios`, `.android`, `.web` | whole repo | Per PR |
| E2E | **Maestro** 2.6.1 | `__e2e__/flows` — 17 YAML flows | **Nightly** |
| Perf | Flashlight over a Maestro flow | `__e2e__/perf-test.yml` | On demand |

Two things stand out.

**Their pyramid is inverted.** A production app at that scale has eleven unit
test files. Almost all behavioural confidence lives in the 17 Maestro flows —
login, onboarding, composer, profile edit, search, curate/mod lists, thread
muting, feed reorder. The rest is carried by per-platform typechecking.

**E2E is nightly, not per-PR.** `nightly-e2e.yml` runs on `macos-26-xlarge` with
a 120-minute timeout, booting an iOS simulator and an Android emulator, doing a
full EAS local build for each. That is far too slow and too expensive to gate a
PR on. Per-PR they run lint, the three typechecks, Jest, and bundle-size /
fingerprint diffs.

We should expect the same economics. **Mobile e2e is a nightly job, not a
merge gate.**

### The three mechanisms worth stealing

These are the transferable parts. The tool is replaceable; these are not.

**1. A fresh backend per flow.** Every flow starts with:

```yaml
- runScript:
    file: ../setupServer.js
    env:
      SERVER_PATH: "?users"
- runFlow:
    file: ../setupApp.yml
```

`setupServer.js` POSTs to a local dev-env server on `:1986`, which provisions a
fresh test PDS seeded with the requested fixture and returns its `appviewDid`.
`setupApp.yml` then launches the app with `clearState: true` and types that DID
into a hidden `e2eProxyHeaderInput` field, pointing the app at that ephemeral
backend. Every flow gets clean, isolated state.

This is the fix for a problem we already have. `apps/web/playwright.config.ts`
says:

```ts
// The full loop mutates shared per-deployment state, so keep it serial.
fullyParallel: false,
workers: 1,
```

We serialise because all specs share one Convex deployment. Adding a mobile
client makes that worse — two clients contending for one backend. If we build
per-flow backend provisioning for mobile, web should use it too, and the web
suite gets to go parallel as a side effect.

**2. Build-time module substitution for untestable platform APIs.** Their e2e
build sets `RN_SRC_EXT=e2e.ts,e2e.tsx`, so Metro resolves
`notifications.e2e.ts` in preference to `notifications.ts`. Two modules are
swapped this way: push notifications and nag/reminder scheduling. Neither can be
driven from a UI test, so they are replaced at build time rather than mocked at
runtime.

This is cleaner than runtime mocking and there is no equivalent trick in
Playwright, because there is no bundler substitution step in a browser e2e run.
Worth designing for from the start.

**3. `testID` is the selector contract.** Flows select by `id:` almost
exclusively:

```yaml
- tapOn: {id: "composeFAB"}
- tapOn: {id: "composerPublishBtn"}
- assertVisible: {id: "selectedPhotosView"}
```

Text selectors barely appear, because Bluesky localises through Lingui/Crowdin
and text-based selectors would break on every translation.

This matters more for us than it looks. React Native has no DOM and no ARIA
roles, so the role- and text-based locators our Playwright specs lean on **do
not port**. We have already been bitten by locator fragility on the web side
(the auto-loading card on `/pantry` broke every `listitem` locator). Mobile
forces the discipline: named `testID`s, treated as API.

Some of their IDs are pure test affordances — `e2eSignInAlice`,
`e2eOpenLoggedOutView`, `e2eRefreshHome` — buttons that exist only to skip
expensive setup. Login-by-UI is written once, in `login.yml`; every other flow
taps `e2eSignInAlice`.

## What this means for us

Our position is better than Bluesky's, because of work already done.

`@pantry/core` is headless with `pure` / `react` / `convex` entry points
(BL-0024), and holds planner, grocery, all five nutrition modules, recipe draft,
week suggestion, calendar, diet presets, quantity formatting and optimistic
updates — 17 vitest files, no DOM. The Go recipe-service owns ranking,
normalization and equipment matching, tested in Go. Convex functions are tested
with convex-test. **None of that is web-specific, so none of it needs a mobile
equivalent.** A React Native client re-uses all three layers unchanged.

That is the payoff for BL-0024 and BL-0026, and it means our mobile-specific
test surface is genuinely narrow: navigation, rendering, native seams, and the
end-to-end journeys.

### Proposed layers

**L1 — logic: nothing to do.** `@pantry/core` vitest suites already cover
mobile. The standing rule is the important part: new shared behaviour goes into
`@pantry/core`, not into `apps/mobile`. Every rule that lands in the app instead
of core is a rule that needs testing twice.

**L2 — components: jest-expo + `@testing-library/react-native`, scoped to
`apps/mobile`.** Flagging the cost honestly: this is a second test runner in a
vitest monorepo. Vitest cannot easily run React Native (the Metro/Flow
transform pipeline is Babel/Jest-shaped), and jest-expo is the maintained path.
Contain it — `apps/mobile` runs jest, everything else stays vitest, and turbo
hides the difference behind `pnpm test`. Bluesky barely uses this layer; I would
use it more than they do, for screens with real state. **The parity plan adopted
this and put the harness inside BL-0056**, so it has no separate testing item —
the per-screen tests ride along with each native screen item.

**L3 — e2e: Maestro, nightly** (BL-0072, BL-0073). Flows in
`apps/mobile/e2e/flows/*.yml`, mirroring
the journeys the Playwright specs already describe — core loop, catalog,
home dashboard, recommendations, prep tasks. Where a spec has a web equivalent,
name them the same so drift is visible.

**L4 — typecheck per platform.** Cheap and high value if we ever add
`.ios.tsx` / `.android.tsx` / `.web.tsx` files: separate tsconfigs catch code
that only compiles on one platform. Skip until platform-conditional files exist.

**L5 — perf: Flashlight, optional.** Runs a Maestro flow while sampling FPS,
CPU and memory, and scores it. Cheap to add once Maestro exists; not worth
building toward.

### Why Maestro over Detox

Detox is the lower-flake option for pure React Native — it is grey-box, hooking
into the RN bridge to know when the app is idle rather than polling the UI. That
is a real advantage and the reason it still has advocates.

It is also React Native only, needs native test-build configuration per
platform, and the ecosystem's migration traffic runs one way. Bluesky ran Detox
for over a year before replacing it. Maestro's declarative YAML with implicit
waiting removes most of the flake that made Detox's synchronisation necessary,
and it covers iOS, Android and web from one tool.

For a team that has not yet written a mobile test, Maestro is the right first
move.

### Sequencing

The parity plan's BL-0056 (Expo app foundation) owns two pieces of this
research directly — it sets up the `jest-expo` + React Native Testing Library
harness, and establishes the `testID` conventions before any screen is built.
Those are therefore **not** separate testing items. Both have now landed: the
harness is in `apps/mobile`, and the selector contract is written up in
[`mobile-testid-conventions.md`](mobile-testid-conventions.md). What remains:

| Item | | Blocked on |
| --- | --- | --- |
| [BL-0070](backlog/BL-0070-parallel-e2e-backend-isolation.md) | Unpin the e2e suite from a single worker | nothing |
| [BL-0071](backlog/BL-0071-portable-test-selectors.md) | Portable test selectors, web half | nothing |
| [BL-0072](backlog/BL-0072-maestro-e2e-harness.md) | Maestro harness + first flow | BL-0056 |
| [BL-0073](backlog/BL-0073-nightly-mobile-e2e.md) | Nightly mobile e2e, flow parity | BL-0072 |

BL-0070 and BL-0071 are worth doing **before** the mobile client exists, because
they pay for themselves on the web side alone: BL-0070 is the highest-leverage
item here and unblocks parallel Playwright runs, and BL-0071 is far cheaper to
establish while there is one client than two.

## Sources

- [bluesky-social/social-app][bsky] — `__e2e__/`, `jest/jestSetup.js`,
  `.github/workflows/nightly-e2e.yml`, `package.json`
- [Replace e2e tests with Maestro (#3983)][bsky-maestro] — the Detox → Maestro cut
- [Maestro documentation](https://maestro.dev)
- [Flashlight](https://flashlight.dev) — RN performance measurement
