---
id: BL-0056
title: Expo app foundation (apps/mobile — Metro, Convex, auth, navigation, styling)
status: proposed
area: mobile
effort: L
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The first increment of the native client. Nothing else in the mobile plan can
start until an Expo app boots, authenticates against the deployed Convex
backend, and renders a navigable shell.

Depends on **BL-0006** (deployment) for on-device testing — a phone cannot
reach `docker compose` on localhost. A dev tunnel is an acceptable stopgap for
simulator work only.

## Proposal

Create `apps/mobile`, an Expo app peer to `apps/web` (not a package). It
consumes `@pantry/types`, `@pantry/core`, `@pantry/core/react`,
`@pantry/core/data`, `@pantry/convex`, and `@pantry/design-tokens`. No view code
is shared in either direction.

Scope:

- **Metro against pnpm workspaces** — the genuinely fiddly part, and the most
  likely place in the whole plan to overrun. Configure the resolver to read
  workspace package *source* rather than `dist/`; this repo has already been
  bitten twice by stale-`dist` failures that surface as runtime errors with no
  type error.
- **Convex client + auth.** `ConvexReactClient` plus `ConvexAuthProvider` with
  `storage` backed by `expo-secure-store` — the provider documents this prop as
  required for React Native, and strips non-alphanumerics from
  `storageNamespace` for RN compatibility. Verify the token size early: iOS
  SecureStore warns above 2048 bytes per value, and a JWT plus refresh token may
  approach it. Fallback is splitting the keys.
- **Expo Router** tabs mirroring the seven `NAV_ITEMS`, with placeholder screens
  for routes not yet ported. Navigation must not leak into shared code.
- **NativeWind** bound to `@pantry/design-tokens` (needs BL-0053).
- **Test harness** — `jest-expo` + React Native Testing Library. A deliberate
  divergence from the repo's Vitest standard; Vitest cannot drive RN. Shared
  logic stays on Vitest.
- **`testID` conventions**, established *before* any screen is built. React
  Native has no DOM and no ARIA roles, so the role- and text-based locators the
  Playwright suite relies on do not port. Retrofitting testIDs across finished
  screens is strictly more expensive than adopting the convention here. See
  `docs/mobile-testing-strategy.md`.
- **CI** — mobile typecheck and unit tests join the normal per-PR gate.

## Alternatives considered

- **Bare React Native instead of Expo.** More control over native modules, at
  the cost of hand-rolling the build, update, and submission pipeline that EAS
  provides. Rejected — nothing in this app needs a custom native module.
- **Vitest for native views.** Keeps one runner across the monorepo, but fights
  the RN preset ecosystem for no benefit to the tests that matter.
