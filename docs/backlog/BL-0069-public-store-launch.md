---
id: BL-0069
title: Public store launch (App Store + Google Play)
status: proposed
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The final increment: move from private distribution (BL-0060) to public
listings on both stores.

Deliberately separated from every other item because it is the only phase whose
duration is mostly **not** under our control — store review is calendar time,
and Google gates new personal developer accounts behind a closed test.

Depends on BL-0068 (account deletion), which is a hard Apple requirement.

## Proposal

- **Apple**: privacy manifest, App Privacy disclosures, store listing,
  screenshots for required device sizes, App Review submission.
- **Google**: Data safety form, store listing, screenshots. If the developer
  account is new and personal, Play requires a **closed test with 12+ testers
  running for 14 continuous days** before production access is granted — start
  this early, since it is pure calendar time.
- Support surfaces a listing needs: a privacy policy URL and a support contact.
- Production backend readiness, which is BL-0006's concern but becomes
  load-bearing here in a way it is not for a handful of internal testers.

## Alternatives considered

- **Stay on TestFlight and the internal track indefinitely.** Genuinely viable
  for a personal or small-group tool, and it skips this entire item. Worth an
  explicit decision rather than drifting into a public launch by default.
- **Launch iOS publicly first, Android later.** Halves the compliance surface
  per attempt, but the Play closed-testing gate is the long pole, so starting it
  late maximises total elapsed time.
