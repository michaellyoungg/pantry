---
id: BL-0003
title: Ingredient normalization + unit conversion + aisle grouping
status: done
area: grocery-list
effort: L
related_specs: [2026-06-29-recipe-to-grocery-list-design.md, 2026-07-12-ingredient-normalization-design.md]
created: 2026-06-29
---

## Context

Milestone 1 aggregates grocery lines by **literal exact-match** on item + unit.
That leaves obvious wins on the table: "garlic" vs "garlic cloves" vs "fresh
garlic" stay separate, and tsp/tbsp/cup or g/kg of the same item don't combine.

## Proposal

Add a normalization layer in recipe-service (where the ingredient data and the
aggregation logic already live):

- Canonical ingredient dictionary (synonyms → canonical item).
- Unit-conversion logic (tsp↔tbsp↔cup, g↔kg, etc.) with sensible rounding.
- Grocery-aisle categorization (produce, dairy, ...) for grouped lists.

URL import (BL-0001), which produces free text, is the moment this earns its
keep.

## Related polish surfaced during Plan 1 review

- **Display casing:** aggregation currently emits the normalized (trimmed,
  lowercased) match key as the display `item`/`unit`, so "Garlic"/"Cloves"
  shows as `garlic`/`cloves`. Preserve first-seen original casing for display
  while still matching on the normalized key.
- **Quantity rounding:** grocery quantities are summed as `float64`, so inputs
  like `0.1 + 0.2` surface as `0.30000000000000004`. Add sensible rounding when
  this normalization layer lands.

## Alternatives considered

- Normalize at write-time vs at aggregate-time — likely aggregate-time so the
  canonical recipe stays faithful to its source. Decide when picked up.
