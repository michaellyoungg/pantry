---
id: BL-0031
title: Normalization dictionary coverage + staple flag
status: done
area: grocery-list
effort: M
related_specs:
  [
    2026-08-03-normalization-coverage-design.md,
    2026-08-03-recommendations-design.md,
    2026-07-12-ingredient-normalization-design.md,
  ]
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

## Progress

**Done.** See
[the design](../superpowers/specs/2026-08-03-normalization-coverage-design.md).

- **Coverage is measured, not asserted.** The instrument and a held-out corpus of
  182 real-world ingredient lines landed *before* any dictionary change, so the
  number is a before/after rather than a claim: **35.7% → 98.4%** on that corpus,
  93.3% → 100% on the seeded catalog. Both are CI floors now.
- **The resolver changed too.** Most misses were modifiers (`chopped fresh
  cilantro`), not vocabulary. `modifiers` is a new data section, stripped only
  from the edges, least-aggressive-first, and only when the remainder is already
  known — so it can never invent a canonical key. Dictionary: 188 → 338 items,
  60 → 199 synonyms.
- **`staple` on 61 pantry items**, which woke up BL-0005's `missingNonStaple`:
  a recipe missing only salt now takes no penalty, says so on the card, and
  `MissingItem.staple` crosses the wire.
- **Unresolved ingredients are visible** via `GET /normalization/coverage` and
  `cmd/normalization-coverage`, ranked by frequency and tagged with the recipes
  they came from.
