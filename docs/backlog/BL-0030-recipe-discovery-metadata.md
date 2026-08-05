---
id: BL-0030
title: Recipe discovery metadata (cuisine, tags, cook time, source URL)
status: done
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

## Outcome

Landed in two parts. **BL-0020** had already shipped the schema half while
building the catalog's filter chips: `cuisine`, `tags`, `total_minutes` and
`source_url` exist end to end (Go store, Postgres, `@pantry/types`, Convex),
the JSON-LD importer already wires `recipeCuisine` / `recipeCategory` /
`keywords` / `totalTime` through, and the recipe form already offers all four
as optional fields. What remained — and what this item delivered — is the part
those fields existed *for*.

**Cuisine is an OPEN vocabulary, not a controlled one.** The proposal above
argued for a controlled `cuisine` plus free tags; BL-0020 shipped the opposite
and its reasoning holds, so this item deliberately did not reverse it. Nothing
*keys* on a cuisine (unlike cooking methods, which BL-0042's prep rules match
on), and an import that meets a cuisine we have never heard of should keep it
rather than drop it. What the proposal actually wanted from "controlled" —
that one cuisine is one chip — is delivered by enforcing a single *spelling*
via `slugify`, not by a closed enum.

There is **one** recipe-side cuisine field. The `cuisines` array on the Convex
side is a different thing: a recipe has one cuisine, a cook likes several. Both
sides are slugs from the same vocabulary, which is what makes them comparable.

Turned on in `internal/recommend`:

- `cuisineMatch` and `timeFit`, contributing under the existing
  availability-normalized `combine()` — no ranker restructuring.
- **Absence of data is UNAVAILABLE, never zero**, per BL-0040's precedent. An
  untagged recipe drops out of the average rather than being scored badly,
  because most recipes — and all of a user's own — predate the facets.
- **An unknown cook time matches no time bucket.** A recipe nobody timed is not
  a fast recipe. This mirrors the catalog filter chips, which already refused
  the same inference.
- A facet we *did* measure and the user did not ask for scores zero: we know an
  Italian dish is not the Thai they wanted, and we do not know that about an
  untagged one.

Also required, and easy to miss: the stored tastes had no way to reach the
ranker (both surfaces dropped them from the request), `maxMinutes` could be set
but never cleared, and there was no UI to set either. All three are fixed.

`sourceUrl` on curated catalog entries is now *supported*; no existing entry
carries one, because they are hand-written and a fabricated attribution is
worse than none.
