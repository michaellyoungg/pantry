---
id: BL-0057
title: Component tests for the mobile client (jest-expo)
status: proposed
area: mobile
effort: S
related_specs: []
created: 2026-08-16
---

## Context

The mobile testing research (`docs/mobile-testing-strategy.md`) found that our
logic layer needs no mobile equivalent at all. `@pantry/core` is headless with
`pure` / `react` / `convex` entry points (BL-0024) and holds the planner,
grocery aggregation, all five nutrition modules, recipe draft, week suggestion,
calendar, diet presets, quantity formatting and optimistic updates — 17 vitest
files, no DOM. recipe-service owns ranking, normalization and equipment matching,
tested in Go. Convex functions are tested with convex-test. A React Native client
reuses all three unchanged.

That leaves a genuinely narrow mobile-specific surface: screens, navigation and
the native seams. Bluesky barely tests this layer — `@testing-library/react-native`
is installed and their 11 unit test files are all pure utils, with confidence
carried by Maestro flows and per-platform typechecking. We should test it a
little more than they do, because our flows will be fewer, but it is the smallest
of the three items here rather than the largest.

The cost to be honest about: **this introduces a second test runner.** Vitest
cannot readily run React Native — the Metro transform pipeline is Babel/Jest
shaped — and `jest-expo` is the maintained path.

## Proposal

- Add `jest-expo` + `@testing-library/react-native`, scoped to `apps/mobile`
  only. Everything else in the monorepo stays on vitest, and `turbo` hides the
  difference behind `pnpm test`.
- Test screens with real state — the ones where a rendering bug would not be
  caught by a core unit test and would not be worth a whole Maestro flow.
- Do **not** re-test logic that already has a `@pantry/core` test. The standing
  rule from the research is the point of this item: new shared behaviour goes
  into `@pantry/core`, not into `apps/mobile`. Every rule that lands in the app
  instead of core is a rule that needs testing twice, and the second copy is the
  one that rots.
- Run it per PR alongside lint and typecheck, since it is fast — this is the
  mobile half of the fast-checks tier that BL-0056 deliberately keeps mobile e2e
  out of.

## Alternatives considered

- **Skip the layer entirely, as Bluesky effectively does.** Avoids the second
  runner, and is defensible given how much `@pantry/core` covers. But it puts all
  UI confidence in nightly flows, so a rendering regression is found the next
  morning rather than in review.
- **Make vitest run React Native.** Keeps one runner, which is genuinely
  appealing. The RN preset story under vitest is still rough and we would own the
  breakage on every Expo upgrade — a poor trade for a small test tier.
- **Storybook + visual snapshots instead.** Better at catching visual regression
  than either option, and useful for building the shared primitives. Orthogonal
  to this item rather than an alternative; worth its own backlog entry if the
  design system grows.
