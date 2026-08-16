---
id: BL-0059
title: Native pantry route
status: in-progress
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The second half of the in-store/in-kitchen loop. Pantry is where check-off
inflow lands (BL-0021), where expiry nudges surface (BL-0029), and where
"use it up" suggestions come from (BL-0050) — all of which are more useful
standing in front of a fridge than sitting at a desk.

Completes the subset that makes the first private build worth installing.
Depends on BL-0056 and BL-0055.

## Proposal

Port `/pantry` to native views: current inventory, expiry state, don't-rebuy
signals, and the unified use-it-up suggestion surface.

Server-side logic is unchanged and untouched — expiry is already a ranker
feature in Go and the suggestion surfaces were unified by BL-0050. This item is
views plus the `usePantry()` hook from BL-0055.

## Alternatives considered

- **Defer pantry until after the parity phase.** Rejected: without it the first
  build shows a grocery list whose check-offs visibly feed a screen the app does
  not have, which reads as broken rather than incomplete.
