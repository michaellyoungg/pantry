---
id: BL-0060
title: EAS build + private distribution (TestFlight, Play internal)
status: proposed
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The point at which the app leaves the simulator and lands on a real phone in a
real shop. Everything before this is unvalidated — the in-store case cannot be
tested from a desk.

Private distribution only. TestFlight internal testing and the Play internal
track require no store review, so this phase has no external latency. Public
store launch is deliberately a separate, later item (BL-0069).

Depends on BL-0057, BL-0058, BL-0059, and on BL-0006 for a reachable backend.

## Proposal

- **EAS Build + EAS Submit** for both platforms, with dev/prod environment
  separation so a device build cannot accidentally point at a local stack.
- **App identity** — icons, splash, bundle identifiers, versioning scheme.
- **TestFlight internal testing** (Apple Developer Program, $99/yr) and the
  **Play internal track** (Play Console, $25 once).
- **Maestro device E2E** covering the in-store loop only — plan a week, generate
  the list, check items off, go offline, reconnect, confirm reconciliation. Run
  **nightly, not as a merge gate**, for the same reason the Playwright suite is
  out of the per-PR gate: it needs real infrastructure and a device.
  See `docs/mobile-testing-strategy.md` for the flow-level design, including the
  per-flow ephemeral backend that also lifts `workers: 1` from
  `playwright.config.ts`.

## Alternatives considered

- **Ad-hoc / sideloaded builds.** Avoids the developer-account cost, but iOS
  ad-hoc provisioning expires and requires device UDID registration, which is
  worse ongoing friction than TestFlight for the same money.
- **Go straight to public store listings.** Adds review latency, privacy
  disclosures, and a blocking account-deletion requirement (BL-0068) to an app
  that has not yet been used in a shop even once.
