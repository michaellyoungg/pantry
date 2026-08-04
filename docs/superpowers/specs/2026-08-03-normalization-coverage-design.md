# Normalization dictionary coverage + the staple flag

- **Backlog item:** [BL-0031](../../backlog/BL-0031-normalization-dictionary-coverage.md)
- **Date:** 2026-08-03
- **Status:** implemented
- **Builds on:** [ingredient normalization](2026-07-12-ingredient-normalization-design.md),
  [recommendations](2026-08-03-recommendations-design.md)

## Summary

`canonicalItem` is the join key under the pantry, don't-rebuy, recommendations
and nutrition gram resolution. A missing dictionary entry does not error — it
produces an item that can never match anything — so the failure always surfaces
somewhere else, as a feature that looks broken.

Three things, in this order:

1. **A metric, built before the dictionary was touched.** Share of ingredient
   lines that resolve to a canonical item, plus the misses ranked by frequency.
2. **A resolver that reads real text**, and a much larger dictionary.
3. **A `staple` flag**, which unblocked a recommendation feature that had been
   shipped-but-inert since BL-0005.

## The metric

> Share of ingredient lines across all stored recipes that resolve to a
> canonical item.

Measured over **raw lines** — `1/4 cup chopped fresh cilantro`, the shape an
import delivers — run through the same parser an import uses. Measuring tidy
item names instead would grade the dictionary on an exam it does not sit.

Two corpora, for two different jobs:

| Corpus | What it is for |
| --- | --- |
| The seeded catalog (`catalog.json`) | Ships with the service, identical everywhere — a hard floor CI can hold at 100% |
| `internal/recipe/testdata/imported-lines.txt` | 182 lines as recipe sites write them: the held-out exam |

The corpus file was committed **before** any dictionary change and is not edited
afterwards. That is the only thing that makes the before/after number mean
anything: coverage has to improve by handling text the dictionary had not seen,
not by rewriting the exam. Adding lines later is fine; changing one to move a
number is not.

**Result: 35.7% → 98.4%** on the imported-line corpus (65/182 → 179/182), and
93.3% → 100% on the seeded catalog. Both are asserted as floors in
`coverage_test.go`, so a dictionary edit that regresses real-world resolution
fails CI rather than quietly stopping the pantry from matching.

The three lines still unresolved name *two* ingredients in one string ("salt and
pepper to taste") or stack qualifiers ("whole milk ricotta cheese"). Those are a
splitting problem and a parsing problem; no dictionary entry fixes them honestly.

## Why the resolver changed, and not just the data

The single biggest source of misses was not vocabulary. It was that real
ingredient text is mostly **modifiers** — `chopped`, `fresh`, `large`,
`low-sodium`, `boneless skinless` — and no plausible number of synonyms covers
their combinations.

So `modifiers` is a new section of `normalization.json`: words that describe how
an ingredient was prepared, sized or graded **without changing what it is**.

The design rejected fuzzy matching because it "produces confident wrong joins
(`chicken stock` → `chicken`), which is worse than no match". Modifier stripping
is not that, and three properties are what keep it honest:

- **It runs only after a literal lookup fails**, and the remainder counts only if
  the table already knows it — the same guard the existing plural folding uses.
  It can never invent a canonical key.
- **It peels from the edges only.** A modifier in the middle is left alone,
  because the words around it are then part of a compound name.
- **It peels the least it can and stops at the first hit.** `crumbled blue
  cheese` is blue cheese; dropping every modifier at once would also eat
  `cheese` and be left holding `blue`.

Words that *change* the item stay out by construction, and a test pins each
class: `canned`/`frozen` (canned tomato and frozen pea are their own items),
colours (`red onion`, `black bean`), nationalities (`italian seasoning`), and
`smoked` (`smoked salmon` is not salmon).

Dictionary size went 188 → 338 items and 60 → 199 synonyms, chosen against what
the catalog and the corpus actually contain.

### One thing the data taught back

`frozen shrimp` cannot be its own frozen-category item. The prep rule engine
(BL-0042) models a frozen **protein** as protein + frozen state, which is what
makes `thaw_frozen_protein` fire; adding the item silently demoted the task to
the generic ingredient rule. Frozen *vegetables* are their own items; frozen
proteins are not. The dictionary carries downstream semantics, not just labels.

## The staple flag

`"staple": true` on a canonical item marks something a cook is assumed to keep on
hand — salt, pepper, oils, the dried spice rack, flour, sugar. 61 items carry it.

- **Explicit, not inferred from the aisle.** The pantry bucket holds flour and
  canned tomatoes side by side: too coarse to drive a scoring penalty.
- **Absent means NOT a staple.** An unknown ingredient is one we cannot promise
  the user has, so it still counts against a recipe.
- **Invariant, held by test:** every staple sits in the `pantry` aisle. A staple
  is a thing on the shelf, not in the fridge — which stops the flag drifting into
  "ingredients I think are common".

### What it unblocked

`missingNonStaple` was written in BL-0005 and reported `available: false`, so a
recipe was penalized for a missing pinch of salt exactly as for missing chicken.
It is now live:

```
value = -(missing ingredients that are NOT staples) / (distinct ingredients)
```

Negative because it is a penalty; the *share* rather than the count because that
is what says something `coverage` does not — coverage knows what you have, this
knows how much of the remainder is a real errand. A recipe missing only salt
scores 0 and takes no penalty at all.

`recommend` stays dependency-free: it reads a `Staple` bool on the candidate
ingredient, and the recipe package — which owns the dictionary — sets it.

The change is also made **visible** rather than only felt. A recipe missing
nothing but staples now says *"You have everything but pantry staples"*, and
`MissingItem` carries `staple` over the wire so a client can de-emphasize the
salt instead of listing it next to the chicken.

## Surfacing the unresolved

Growing the dictionary from real usage requires being able to look at real
misses. Two surfaces, same report shape:

```bash
# the operator command
go run ./cmd/normalization-coverage                    # the seeded catalog
go run ./cmd/normalization-coverage lines.txt          # any exported lines
go run ./cmd/normalization-coverage -json -min 0.9 x.txt  # dashboard / CI gate
```

```
GET /normalization/coverage
```

reports over the caller's recipes plus the shared catalog — the same corpus the
recommender ranks, so the number answers "how well does the dictionary serve
*this* user". Misses come back ranked by frequency and tagged with the recipes
they appeared in, so the most valuable entry to write next is always first.

## Non-goals

- **Splitting compound lines** ("salt and pepper"). A real improvement, but it
  belongs to the import parser, not the dictionary.
- **LLM canonicalization at import time.** Still the alternative worth
  revisiting; still adds a paid runtime dependency and non-determinism to the key
  everything joins on.
- **A staple-aware grocery list.** The flag exists now; whether the list should
  stop adding salt is a product decision and its own item.
