---
id: BL-0043
title: Equipment inventory — "can I make this?" + new-device recipe discovery
status: proposed
area: recipes
effort: M
related_specs: [2026-08-03-cooking-guidance-design.md]
created: 2026-08-03
---

## Context

Once recipes declare the equipment they need (BL-0041), recording what the user
actually owns turns that data around: the app can flag a recipe you can't cook
yet, and it can answer "I just got a sous-vide / panini press / smoker — what
can I make with it?"

That reverse query is the reason the
[cooking guidance design](../superpowers/specs/2026-08-03-cooking-guidance-design.md)
models equipment as catalog entities rather than strings. This item is mostly a
read over data BL-0041 already collects.

## Proposal

- **Convex `equipmentInventory(userId, equipmentId)`** — indexed by user.
  Inventory lives in Convex, not recipe-service, because it's reactive user
  state like `basket` and `groceryList`.
- **"My Kitchen" surface** — browse the equipment catalog by category and check
  off what you own. Reachable from profile/settings.
- **Matching endpoint in recipe-service** — Convex sends the owned slugs,
  recipe-service matches against `recipe_equipment` and returns recipes whose
  **required** equipment is satisfied (optional equipment never blocks). This
  mirrors the existing grocery-list aggregation pattern: user state in Convex,
  matching where the recipe data already is.
- **"I can make this" filter** on catalog/recipe browse.
- **New-device discovery** — when equipment is added to the inventory, surface
  the recipes it unlocks ("new to your kitchen"). This is the headline
  experience; the filter above is the same query without the delta.
- **Signal for recommendations** — owned equipment is a usable feature for
  BL-0005's ranker; wire it if the feature surface is ready, otherwise leave the
  data available and note it.

## Dependencies

**BL-0041** (equipment catalog + recipe equipment). Nothing to match against
without it. Independent of BL-0042 — inventory and prep tasks read the same
equipment data but don't depend on each other.

## Alternatives considered

- **Inventory in recipe-service** — it already holds user-scoped rows, but the
  UI wants inventory reactively and Convex is where user state lives; splitting
  it would put user state on both sides of the line.
- **Infer owned equipment from cooking history** — no explicit setup, but it
  can't distinguish "don't own it" from "haven't cooked it", and the new-device
  moment is exactly when there's no history.
- **Hard-block recipes the user can't cook** — rejected; flag and filter, never
  hide. Borrowing a friend's smoker is a normal thing to do.
