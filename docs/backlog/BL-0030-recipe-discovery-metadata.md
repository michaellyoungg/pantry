---
id: BL-0030
title: Recipe discovery metadata (cuisine, tags, cook time, source URL)
status: in-progress
area: recipes
effort: M
related_specs: [2026-08-03-recommendations-design.md, 2026-07-12-full-app-ux-plan.md]
created: 2026-08-03
---

## Context

A `Recipe` today is `id, user_id, title, created_at` plus an ingredient list.
There is no cuisine, no tags, no cook time, no difficulty, and no source URL.

The full-app UX plan flagged this as cross-cutting decision #4 and recommended
adding `sourceUrl` plus discovery fields; it was never done. The recommendations
design (BL-0005) then hit it directly: **ingredients are the only universal
recipe attribute**, so a preference model built on facets ("I like Thai",
"under 30 minutes") has nothing to score against. Those features are wired in
`internal/recommend` and permanently inert until this lands.

Catalog search and filters (BL-0020) want the same fields for the same reason.

## Proposal

Extend the recipe model end to end:

- **Schema:** `cuisine` (single value), `tags[]`, `total_minutes`, `source_url`.
  Nullable throughout — existing recipes have none of it.
- **Import:** JSON-LD recipe markup already carries `recipeCuisine`,
  `recipeCategory`, `keywords`, `totalTime`, and the canonical URL. The parser
  extracts most of this today and discards it; wire it through instead.
- **Catalog:** populate the fields for curated entries in `catalog.json`.
- **Manual entry:** optional fields on the recipe form, not required.
- **Recommendations:** turn on the `cuisineMatch` and `timeFit` features, which
  then begin contributing under the existing availability-normalized scoring —
  no ranker restructuring needed.

## Alternatives considered

- **Free-form tags only** — cheaper, but unbounded vocabularies make filtering
  and preference-matching unreliable; a controlled `cuisine` field plus free tags
  is the better split.
- **Infer cuisine from ingredients** — no new schema, but it is guesswork that
  would silently mislabel recipes and poison preference matching.
- **Leave it out and rank on ingredients alone** — what the recommendations
  design does today. Works, but caps discovery quality permanently.
