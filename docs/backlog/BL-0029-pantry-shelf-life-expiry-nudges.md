---
id: BL-0029
title: Pantry shelf-life & expiry nudges — category-default dates + "use this week" batches
status: proposed
area: pantry
effort: L
related_specs: [2026-07-18-pantry-thin-loop-design.md]
created: 2026-08-03
---

## Context

BL-0021 increment 1 shipped inflow + don't-rebuy and split shelf-life/expiry out
as **increment 3**. The BL-0021 proposal frames the goal as *category-default
expiry from a shelf-life table on the normalized ingredient (users never
hand-enter dates)* plus *batched, actionable "3 items to use this week → cook
these" nudges* — waste reduction that only earns its keep once expiry data is
real, not guessed.

The increment-1 design
(`docs/superpowers/specs/2026-07-18-pantry-thin-loop-design.md`) deferred this
deliberately: it refused a time-based auto-expiry in increment 1 because *"an
arbitrary staleness constant is a guess dressed up as data."* The real blocker is
data — `normalization.json` currently defines only ~5 items and 7 aisles, so a
shelf-life table hung off it today would be almost entirely the `other` bucket.
Increment 1 already retains the pantry row's `updatedAt` / `source` so a row can
carry forward into this increment's nudges.

## Proposal

- **Expand normalization with shelf-life data.** Add a per-item `shelfLifeDays`
  plus an aisle-level default (produce short, pantry long, etc.) to the
  recipe-service normalization data, and grow the item table enough that
  common perishables aren't all `other`.
- **Expose normalization data to Convex.** No endpoint currently surfaces
  normalization details (shelf life, aisle) to the Convex layer; add one so the
  pantry can compute category-default expiry from the `canonicalItem` without
  duplicating the table.
- **Category-default expiry, never hand-entered.** When an auto-added perishable
  enters the pantry, stamp an approximate "use by" from `shelfLifeDays`. Be
  honest it's approximate; do not ask the user to type dates.
- **Batched, actionable nudges.** Surface a small "N items to use this week →
  cook these" batch (ideally linking to recipes that use them), not per-item
  nag badges. The BL-0021 proposal is explicit that the nudge must be batched
  and actionable, not a stream of individual alerts.

## Alternatives considered

- **Arbitrary staleness constant now** (e.g. auto-expire after N days regardless
  of item) — rejected in the increment-1 design as a guess dressed up as data;
  it belongs here with a real per-item table.
- **User-entered expiry dates** — the exact data-entry friction the whole pantry
  thin-loop exists to avoid; abandoned-by-week-four pattern.
- **Per-item nag badges** — noisier than a batched weekly "use these" prompt and
  less likely to drive an actual cook.
