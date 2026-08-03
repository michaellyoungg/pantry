---
id: BL-0031
title: Normalization dictionary coverage + staple flag
status: proposed
area: grocery-list
effort: M
related_specs: [2026-08-03-recommendations-design.md, 2026-07-12-ingredient-normalization-design.md]
created: 2026-08-03
---

## Context

BL-0003 built the ingredient normalization *machinery* — synonym resolution, unit
conversion, aisle grouping — and it works. What it did not build is the
**dictionary**. `normalization.json` currently defines **5 canonical items and 3
synonyms**.

Every downstream feature joins on `canonicalItem`:

- **Pantry** (BL-0021) keys its rows on it.
- **Don't-rebuy** matches grocery lines against pantry rows through it.
- **Recommendations** (BL-0005) computes pantry coverage entirely through it —
  an unrecognized ingredient cannot match anything, so coverage reads near-zero
  and the recommender looks broken when the real problem is a missing dictionary
  entry.

The recommendations design names this its **highest risk**, above corpus size.

## Proposal

- **Populate the dictionary** to cover the common grocery vocabulary — target the
  ingredients actually appearing in the catalog and in imported recipes, rather
  than an abstract ideal list. Measure coverage as "share of ingredient lines
  across all stored recipes that resolve to a canonical item" and track it.
- **Add a `staple` flag** to canonical item records (salt, pepper, oil, common
  spices, flour, sugar). Recommendations uses it for the `missingNonStaple`
  feature so a recipe is not penalized for a missing pinch of salt the way it is
  for missing chicken. The feature is already written and reports unavailable
  until this flag exists.
- **Surface unresolved ingredients** somewhere an operator can see them, so the
  dictionary grows from real usage instead of guesses.

## Alternatives considered

- **Fuzzy/stemming match instead of a dictionary** — cheaper to write, but
  produces confident wrong joins ("chicken stock" → "chicken"), which is worse
  than no match for a pantry that then tells you to buy the wrong thing.
- **LLM-based canonicalization at import time** — plausible and worth revisiting,
  but it adds a paid runtime dependency to the import path and non-determinism to
  a key that everything else joins on.
- **Infer staples from the `pantry` aisle** — free, but the aisle bucket contains
  flour and canned tomatoes alongside salt; too coarse to drive a scoring
  penalty.
