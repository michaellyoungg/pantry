---
id: BL-0021
title: Pantry thin loop — auto-add from check-off, don't-rebuy, cook-decrement
status: proposed
area: pantry
effort: L
related_specs: [2026-07-12-full-app-ux-plan.md]
created: 2026-07-12
---

## Context

Pantry-tracking is a feature graveyard: apps die from data-entry friction and inventory
staleness, not lack of demand. Do **not** build "log everything in your kitchen." Our unfair
advantage is the recipe-service normalization layer + the existing check-off loop, which let
us build the two input mechanisms that actually survive real use — without asking users to
type or scan. Waste reduction is secondary for the persona, so pantry must earn its keep on
"don't rebuy / faster lists." Depends on the planner's "mark cooked" event (BL-0018).

## Proposal

- **Inflow: auto-add from grocery check-off** — checking an item off the live list becomes a
  pantry item keyed on the same normalized ingredient id (no re-typing, no duplicates). One
  undo/settings toggle for exceptions.
- **Outflow: cook-decrement** — marking a planned recipe "cooked" subtracts its normalized
  ingredients. The only outflow signal that survives; gates everything downstream.
- **Category-default expiry** from a shelf-life table on the normalized ingredient (users
  never hand-enter dates); **batched, actionable** "3 items to use this week → cook these"
  nudges.
- **"Don't rebuy":** grocery-list generation diffs against pantry and greys/pre-checks
  already-owned items — the tangible money-saving win.
- Track a narrow set: auto-added perishables (with expiry) + a small user-curated staples
  list as have/low. Be honest it's approximate; don't model exact quantities.

## Alternatives considered

- **Full manual inventory** — the death-spiral pattern; abandoned by week four.
- **Barcode / receipt / photo / AI input** — vision layer; higher friction or cost, deferred
  until the thin auto-loop proves the concept.
- **Waste analytics first** — only credible once the outflow signal is trustworthy.
