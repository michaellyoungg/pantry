---
id: BL-0057
title: Native grocery list (aisle sections, one-handed check-off)
status: in-progress
area: mobile
effort: M
related_specs: [2026-08-16-mobile-client-parity-design.md]
created: 2026-08-16
---

## Context

The first real screen, and the reason the native client exists at all. Standing
in a shop holding a phone is the use case a browser serves worst and a native
app serves best.

Depends on BL-0056 (foundation) and BL-0055 (`useGroceryList()`).

## Proposal

Port `/list` to native views: aisle sections, provenance, purchase and residue
lines, manual add, and done-shopping. All grouping and formatting already exists
in `@pantry/core` (`groupByAisle`, `purchaseText`, `residueText`,
`partitionRemoved`, `formatQuantity`) and is consumed unchanged.

The native-specific work is interaction, not logic: **one-handed check-off**
sized for a thumb while pushing a trolley, section headers that stay legible
while scrolling, and hit targets that tolerate a moving hand.

Offline behaviour is explicitly **not** in this item — see BL-0058. This screen
assumes connectivity and is expected to be replaced-in-place by the offline
version.

## Alternatives considered

- **Ship offline in the same item.** Rejected: offline is the riskiest single
  feature in the plan and deserves its own changeset, its own tests, and its own
  review.
- **Reuse the web layout wholesale.** A phone-width web layout already exists,
  but "renders at 390px" and "usable one-handed in a shop" are different bars,
  and the second is the entire justification for the project.
