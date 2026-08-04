---
id: BL-0052
title: Avoid-list canonicalization + allergen families
status: done
area: recommendations
effort: M
related_specs: [2026-08-03-recommendations-design.md]
created: 2026-08-03
---

## Context

BL-0005 increment 1 ships an **avoid list**: ingredients the user names are
removed from recommendations entirely, never merely down-ranked. The final
review of that work found the matching is weaker than the UI implies, in two
distinct ways.

**1. Entries are not canonicalized.** `preferences.set` lowercases and trims;
Go's `Normalizer.Details` additionally resolves a 44-entry synonym table and
folds plurals. `containsAvoided` then does an exact map lookup against
`CanonicalItem(ing.Item)`. So a user who avoids `scallion` gets nothing
filtered — `scallion` resolves to the canonical `green onion`, and the stored
raw key matches no canonical item at all.

**2. Ingredients have families the data model doesn't express.** `peanut` is not
a canonical item; `peanut butter` is. Avoiding "peanut" therefore does not
exclude peanut butter. For a ranking preference that is a shrug; for a declared
allergy it is the failure that matters most.

Increment 1 shipped with the copy corrected to describe exact-name matching
rather than a blanket guarantee, and with `DIET_SEEDS` rebuilt from real
canonical keys (plus a test pinning that). This item closes the underlying gap.

## Proposal

- **Canonicalize on entry.** Resolve each avoid entry through the existing
  `POST /normalization/lookup` before storing, so `scallion` is stored as
  `green onion`. Needs a Convex action (the current `set` is a mutation, and
  mutations cannot do network I/O).
- **Show the user what was resolved**, and say plainly when an entry matches no
  known ingredient — an avoid entry that silently matches nothing is the whole
  bug. This doubles as dictionary-coverage feedback (BL-0031).
- **Model allergen families.** Add a coarse grouping to the normalized ingredient
  record (`peanut butter`, `peanut oil` → `peanut`) so avoiding the family
  excludes its members. Keep it small and explicit — the common allergens, not a
  general ontology.
- **Test the property, not the instance.** Existing tests use `peanut` as both
  the avoid entry and the literal ingredient text, so only the identity case is
  covered. Add cases where the entry and the recipe text differ.

## Alternatives considered

- **Free-text substring matching** — would catch peanut/peanut butter, but
  `egg` matching `eggplant` is exactly the kind of false positive that makes
  users distrust and abandon the filter.
- **Canonicalize at scoring time instead of on entry** — keeps writes simple,
  but re-resolves on every request and leaves the stored data misleading to
  anything else that reads it.
- **Leave it and rely on copy** — what increment 1 does. Honest, but it caps the
  feature at "ranking preference" and forecloses ever describing it as an
  allergy control.

## Outcome

Shipped as the full proposal. See the
[recommendations design](../superpowers/specs/2026-08-03-recommendations-design.md#canonicalization-on-entry-and-allergen-families-bl-0052).

- **Entries are canonicalized before they are stored.**
  `preferences.addAvoidItems` is a Convex *action* — a mutation cannot make the
  call — and resolves through `POST /normalization/avoid`, a new sibling of
  `/normalization/lookup`. Lookup deduplicates its results, so it can tell a
  caller what a *set* of items resolves to but never what any particular entry
  became; an avoid list needs the second answer. The write **fails closed**: an
  unreachable dictionary stores nothing rather than an entry that would filter
  nothing. Removal stays a plain mutation, so an entry can always be taken off.
- **Allergen families** live in a top-level `allergens` block in
  `normalization.json`: nine common allergens, each with its display name, the
  names a user might type, and its canonical members. Membership is listed by
  family, not as a field on each item, because items belong to more than one
  (`egg noodles` are egg *and* wheat) and because a family is only reviewable as
  a whole. The loader **rejects** a member that is not a canonical item, and a
  name two families claim — both are the same silent no-match, and neither shows
  up at request time. Family names beat the identically-named item when
  resolving, so "milk" means dairy; the members come back with the answer, so
  the wider reading is stated rather than assumed.
- **The resolution is stored** beside the entry (`preferences.avoidResolutions`)
  so the settings screen still knows, after a reload, that `green onion` came
  from someone typing "scallion" and that `unobtainium` matches nothing. It is
  additive: `avoidItems` remains what the ranker filters on, and rows written
  before it render as the bare keys they are, claiming nothing.
- **Tests exercise the property, not the instance.** The old cases used "peanut"
  as both the entry and the ingredient text, which passes with no
  canonicalization at all. The new ones differ on both sides — "scallion" vs
  "chopped Scallions", "peanut" vs "creamy peanut butter" — in Go unit tests, in
  the `recommend` package, and in the browser.

### Known limits

- **Wheat is wheat, not gluten.** Barley and rye are not in the wheat family,
  because they are not wheat. Someone typing "gluten" is told plainly that it
  matches nothing rather than being given a family that would quietly miss
  barley. A gluten grouping is a separate, honest piece of work.
- **Some members are judgement calls in the safe direction**: coconut counts as
  a tree nut (as the FDA classifies it), worcestershire sauce as fish (anchovy),
  mayonnaise as egg, and `tortilla` as wheat although corn tortillas exist. Over-
  removal costs a recipe; under-removal costs more. Every one of them is visible
  in the family's member list on screen.
- **Punctuation still defeats canonicalization on the recipe side.** An
  ingredient written `Scallions, chopped` does not resolve — the modifier strip
  leaves a trailing comma. The importer splits that clause off, so it mostly
  affects hand-entered text. That is dictionary coverage (BL-0031), not the
  avoid list.
