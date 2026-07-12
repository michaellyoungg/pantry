---
id: BL-0002
title: Seeded recipe catalog
status: in-progress
area: recipes
effort: M
related_specs: [2026-06-29-recipe-to-grocery-list-design.md, 2026-07-12-seeded-recipe-catalog-design.md]
created: 2026-06-29
---

## Context

To demo the grocery-list aggregation and the discovery experience without
data-entry friction, ship a starter set of recipes users can browse and pick
from. These are shared, non-user-owned recipe definitions — a natural fit for
the recipe-service's canonical store.

## Proposal

Define a seed dataset of structured recipes loaded into recipe-service. Add a
browse/list endpoint and basic UI to pick catalog recipes into the meal basket.
Catalog recipes are owned by the system (no `user_id`, or a reserved one) and
referenced by users the same way user-authored recipes are.

## Alternatives considered

- Manual-entry only — too much friction to populate; rejected as the long-term
  answer but chosen for M1.
