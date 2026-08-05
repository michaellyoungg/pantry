---
id: BL-0034
title: LLM candidate provider for recommendations
status: in-progress
area: recommendations
effort: M
related_specs: [2026-08-03-recommendations-design.md]
created: 2026-08-03
---

## Context

`/recommendations/discover` ranks a corpus. The corpus is the seeded catalog
(BL-0002) plus whatever the user has imported. Ranking a handful of recipes is a
sort, not a recommender — the cold-start problem is structural, and no amount of
scoring quality fixes it.

An LLM sidesteps retrieval entirely: given pantry contents and preferences,
*generate* recipe ideas rather than look them up. It is genuinely strong at "what
can I make with these five things", which is precisely the pantry intent.

The repo already has the plumbing — `import_llm.go` exists as the import
fallback, currently dark (no API key configured).

The BL-0005 design anticipated this: recommendation results carry a `source`
field (`"catalog" | "user"`, with `"generated"` reserved), so this lands as a new
candidate provider behind the existing contract rather than a rewrite.

## Proposal

- **A candidate provider**, not a replacement ranker. Generated candidates enter
  the same pool and are scored by the same features, so hard filters (the avoid
  list) apply to them identically — a generated recipe must never bypass an
  allergy filter.
- **Clearly labelled in the UI.** A generated suggestion is not a curated,
  tested recipe, and presenting it as one is dishonest.
- **Persisted on accept.** A suggestion the user adds to their plan becomes a
  real recipe row they own, so it survives and is plannable. Generated
  candidates nobody accepts are never stored.
- **Off by default, behind config.** No API key means no generated candidates and
  no errors — the endpoint degrades to corpus-only, which is the current
  behaviour.
- **Bounded cost.** Generation is not on the hot path for every request; gate it
  on the corpus-ranked results being thin.

## Alternatives considered

- **LLM as the whole recommender** — replaces scoring with a prompt. Loses
  determinism, makes the avoid-list hard filter a matter of prompt compliance
  rather than code (unacceptable for allergies), and discards the pantry and
  event signals the rest of the design is built on.
- **External recipe API for corpus breadth** — real recipes rather than invented
  ones, but a licensing and ToS problem; BL-0023's research hit exactly this wall
  with Spoonacular's one-hour caching limit.
- **Just grow the catalog** (BL-0002) — the honest baseline, and it should happen
  regardless. Curated recipes beat generated ones; this item is for the long tail
  curation will never cover.
