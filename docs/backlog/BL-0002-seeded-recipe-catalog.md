---
id: BL-0002
title: Seeded recipe catalog
status: done
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

## Progress

The store, the `cat-*` sentinel ownership model, the `/catalog` endpoint and the
browse UI all landed early. What stayed unfinished was the dataset itself: six
recipes, which is a demo fixture rather than a corpus.

**Closed** by growing `catalog.json` to **57 recipes** spanning 16 cuisines,
every cook-time filter bucket and all 12 cooking methods. The size is the point:
discovery search and the filter chips (BL-0020/BL-0030), the recommendation
ranker (BL-0005), "suggest my week" (BL-0033) and the nutrition rollups
(BL-0037) all discriminate *between* recipes, and on six entries there was
nothing to discriminate with.

Also in that changeset:

- **Servings (BL-0035) became seedable.** `catalogEntry` had no such field, so
  every catalog recipe loaded with a nil yield and per-serving nutrition had
  nothing to divide by. Now plumbed through, with a non-positive value failing
  the boot instead of becoming a division by zero.
- **Seven new `normalization.json` items** (pancetta, queso fresco, bean sprout,
  lemongrass, kimchi, tamarind paste, harissa), edited as text rather than
  re-dumped, each carrying the aisle/category/staple flags the prep and allergen
  rules key on. Catalog coverage stays at **100%** (448/448 lines).
- `sourceUrl` is left unset throughout — these entries are hand-written, and an
  invented attribution is worse than none.

Verified against a real database: `cmd/seed` wrote all 57 recipes and their 448
ingredient rows to the compose Postgres.
