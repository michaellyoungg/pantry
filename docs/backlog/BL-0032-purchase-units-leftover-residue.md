---
id: BL-0032
title: Purchase units + leftover residue inference
status: proposed
area: grocery-list
effort: L
related_specs: [2026-08-03-recommendations-design.md]
created: 2026-08-03
---

## Context

The aggregated grocery list emits **recipe units, not purchase units**. It will
tell you to buy "2 tbsp parsley". Nobody sells 2 tbsp of parsley — you buy a
bunch. The list is quietly wrong in a way users absorb silently, and the
arithmetic nobody is doing is the interesting part: *bought a bunch, needed
2 tbsp, so most of a bunch outlives the recipe that bought it.*

That surplus is exactly the "leftover ingredient" the recommendations design
(BL-0005) wants for its use-it-up feature. That design captures leftovers by
**explicit user input** instead, because the pack-size data required to infer
them does not exist anywhere today. This item is the inference path.

Note the distinction the design draws: leftover **portions** (cooked food) are
already modelled as `basket.type: "leftover"`. This is about leftover raw
**ingredients**.

## Proposal

- **Add purchase unit + typical pack size** to canonical item records in
  `normalization.json` (e.g. parsley → 1 bunch ≈ 0.5 cup; buttermilk → 1 quart).
  Same file that BL-0031 populates, so the two are natural companions.
- **Emit purchase units on the grocery list** — "1 bunch parsley" rather than
  "2 tbsp parsley". This is worth shipping on its own merits, independent of
  recommendations.
- **Compute residue at list generation** — need-vs-pack per line — and record the
  surplus.
- **Propose, don't assert.** After a shop, pre-fill a "you probably have these
  left over" set that the user confirms or dismisses per item, writing through to
  `pantryItems.useItUp`. The confirmation tap doubles as an outflow signal at the
  one moment the user is already thinking about that ingredient, which partially
  delivers BL-0028's value.

## Alternatives considered

- **Explicit user entry only** — what BL-0005 ships. Zero new data, ships fast,
  but it is the manual-entry pattern BL-0021 identified as the pantry death
  spiral, and it asks for typing when users have least patience.
- **Inference with no confirmation** — frictionless, but wrong entries never get
  corrected and the recommender confidently suggests recipes for parsley thrown
  out weeks ago.
- **Per-retailer real pack sizes** — accurate, but it inherits every access and
  ToS constraint catalogued in BL-0023, for a marginal gain over a typical-size
  table.
