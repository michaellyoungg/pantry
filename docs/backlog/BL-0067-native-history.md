---
id: BL-0067
title: Native history (habit review)
status: proposed
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

`/history` is the habit review built by BL-0039 — trends, goal-met rates, day
coverage, and the excluded-day reasons that keep the summary honest.

Last route in the parity phase, and the least urgent on a phone: it is a
reflective, chart-heavy screen nobody opens in a shop.

## Proposal

Port `HabitReview` to native views. `habitReview`, `goalMetRates`,
`habitSignal`, and `MIN_DAY_COVERAGE` already live in `@pantry/core` and are
consumed unchanged.

The work is charting. React Native has no SVG-by-default story, so this item
picks and introduces a native charting approach — the one genuinely new
dependency decision left in the plan.

Coverage honesty carries over: a day excluded for insufficient coverage must
read as excluded, never as a zero.

## Alternatives considered

- **Leave History web-only permanently.** The cheapest honest answer, and it
  avoids adding a charting dependency to the native client for the least-used
  route. Revisit before starting.
- **Render charts as server-generated images.** Removes the dependency question
  but adds a rendering path the app does not otherwise need, and loses
  interactivity.
