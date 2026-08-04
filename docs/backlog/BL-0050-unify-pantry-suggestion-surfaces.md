---
id: BL-0050
title: Unify the two pantry suggestion surfaces (expiry vs. recommendations)
status: done
area: pantry
effort: M
related_specs:
  [
    2026-08-03-unified-use-it-up-design.md,
    2026-08-03-recommendations-design.md,
    2026-07-18-pantry-thin-loop-design.md,
  ]
created: 2026-08-03
---

## Context

`/pantry` now renders **two** cards that both suggest recipes to use things up,
built independently and merged without ever having been designed together:

- `<UseItUp />` (BL-0029) — expiry-driven. Calls `pantry.recipesToUse` →
  `POST /recipes/using`.
- `<UseItUpSuggestions />` (BL-0005) — pantry/preference-driven. Calls
  `recommendations.pantry` → `POST /recommendations/pantry`.

Two problems follow, one cosmetic and one not.

**The IA is confusing.** Two cards on one screen, both about using things up,
with near-identical names and overlapping results.

**Only one of them honours the avoid list.** `/recipes/using` applies no
preference filtering. So on the same screen where one card removes recipes
containing an avoided ingredient, the other can recommend exactly such a recipe.
Before BL-0005 that was simply an unfiltered feature; now the product makes an
explicit promise on that screen and then violates it a few hundred pixels away.
That is worse than either behavior alone.

## Proposal

- **Route both through the ranker.** Expiry urgency is already a designed-for
  feature of the recommendation scoring (`expiryUrgency`, currently reporting
  unavailable). Feeding shelf-life data in and letting one ranker serve both
  intents removes the duplication at the root rather than papering over it, and
  it is what the BL-0005 design anticipated.
- **One surface, ordered by urgency.** A single "use it up" card where
  expiring-soon items are the strongest signal, with reasons that say which
  driver applied ("expires in 2 days", "uses 4 things you have").
- **Until then, at minimum:** apply the avoid list to `/recipes/using` too, so
  the safety promise holds everywhere on the screen.

## Alternatives considered

- **Keep both, rename for clarity** — cheapest, and it fixes the naming
  confusion, but it leaves two code paths, two scoring notions, and the
  filtering inconsistency.
- **Drop `<UseItUp />`** — the recommendation ranker cannot yet express expiry
  urgency (needs shelf-life wired into scoring), so this would lose real
  BL-0029 functionality.
- **Drop `<UseItUpSuggestions />`** — loses preference filtering and the
  use-it-up flag, which is the differentiated half.

## Outcome

Shipped as the full proposal, not the "at minimum" fallback. See
[the design](../superpowers/specs/2026-08-03-unified-use-it-up-design.md).

- **`expiryUrgency` is live.** Shelf life (`useBy`) and the caller's clock ride
  in the request body, so the ranker stays stateless and pure. Per candidate the
  value is the MAX over its ingredients, and availability is decided per request
  so scores in one response stay comparable.
- **`POST /recipes/using` and `pantry.recipesToUse` are deleted**, not filtered.
  Filtering them would have left an unfiltered-by-design search endpoint for the
  next feature to find; now the only path applies the avoid list.
- **One card**, `<UseItUp />`, on both `/pantry` and Home. Urgency leaves the
  ranker as a structured field so "use this soon" renders distinctly from
  "you'd like this" instead of being prefix-matched out of a reason string.

**Which signal wins:** the avoid list beats everything (hard pre-filter, never a
weight); below it urgency beats fit, because a wrong taste prediction costs a
scroll and a missed deadline costs food. Urgency (3.5) sits narrowly above the
explicit use-it-up flag (3.0) — a flag is a priority, a spoil date is a
constraint.
