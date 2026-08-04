---
id: BL-0052
title: Avoid-list canonicalization + allergen families
status: in-progress
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
