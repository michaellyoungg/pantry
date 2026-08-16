---
id: BL-0072
title: Maestro e2e harness for the mobile client
status: proposed
area: mobile
effort: M
related_specs: []
created: 2026-08-16
---

## Context

Depends on the Expo app foundation (BL-0056). The mobile client is native Expo,
settled by the mobile client parity plan, so the wrapper caveat in
`docs/mobile-testing-strategy.md` no longer applies.

Playwright cannot drive a native app, so a mobile client ships with no end-to-end
coverage until something replaces it. The research picked **Maestro**: it is what
Bluesky uses today, having run Detox from 2023 and replaced it in May 2024
(bluesky-social/social-app#3983). Flows are YAML, there is no native test-build
configuration to maintain, and one tool covers iOS and Android.

This item is the harness and the first flow only — proving the loop end to end.
Growing coverage and wiring nightly CI is BL-0073.

## Proposal

- Add Maestro (pinned version, checksum-verified install, as Bluesky does) and an
  `apps/mobile/e2e/` directory with `config.yml` and `flows/`.
- Land exactly one flow — sign in, land on the plan — and make it pass locally on
  both an iOS simulator and an Android emulator. One flow that genuinely passes
  on both is the deliverable; a suite that only works on the author's simulator
  is not.
- Point the app at the local compose stack the way the browser suite does, using
  whatever isolation BL-0070 lands. Android emulators reach the host on
  `10.0.2.2`, not `localhost` — Bluesky's `setupApp.yml` branches on platform for
  exactly this, and it is the first thing that will break.
- Build the **e2e module substitution** seam now rather than retrofitting it.
  Bluesky sets `RN_SRC_EXT=e2e.ts,e2e.tsx` so Metro resolves `notifications.e2e.ts`
  over `notifications.ts` in e2e builds, swapping out push notifications and
  reminder scheduling — platform APIs no UI test can drive. We will need the same
  seam for at least notifications if prep-task reminders ship. Substituting at
  build time is cleaner than runtime mocking, and there is no Playwright
  equivalent to copy from, so it wants deciding deliberately.
- Use the testID conventions BL-0056 establishes as part of the Expo foundation.
  If they are not in place yet, this flow is the forcing function for them.

## Alternatives considered

- **Detox.** Grey-box, hooking the RN bridge to know when the app is idle rather
  than polling the UI, which genuinely buys lower flake. But it is React Native
  only, needs per-platform native test-build config, and the migration traffic
  runs one way — including Bluesky's. Wrong first move for a team with no mobile
  tests yet.
- **Appium.** Broadest device and platform reach, and the only real answer if we
  ever need physical-device farms. Slowest of the three and the heaviest to
  maintain; revisit only if real-device coverage becomes a requirement.
- **Maestro for web too, retiring Playwright.** Tempting for a single flow
  vocabulary across both clients. Rejected: Playwright is materially better at
  the web, our eight specs are mature, and rewriting working coverage to buy
  symmetry is a bad trade.
- **No mobile e2e; rely on core unit tests.** `@pantry/core` genuinely does cover
  the logic, so this is less reckless than it sounds — but it leaves navigation,
  rendering and every native seam untested, which is precisely the part that is
  new.
