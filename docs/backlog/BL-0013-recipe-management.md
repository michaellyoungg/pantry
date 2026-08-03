---
id: BL-0013
title: Recipe management — de-dup + delete
status: done
area: recipes
effort: M
related_specs: [2026-06-29-web-app.md]
created: 2026-06-30
---

## Context

Surfaced while using the live app. Creating a recipe always inserts a new row,
so repeated/identical titles stack up ("Garlic Bread" ×2, etc.), and there is no
way to remove a recipe. The Recipes list grows unbounded and gets noisy fast.

## Proposal

- Add a `DELETE /recipes/{id}` endpoint to recipe-service (+ a Convex/UI affordance
  to remove a recipe), with cascade already handled by the `ON DELETE CASCADE` on
  ingredients.
- Decide on duplicate handling: either allow duplicates (current) but add
  edit/delete, or warn on an exact-title match. Likely just add delete + edit and
  leave duplicates legal.
- Consider pagination/search on the list once the catalog (BL-0002) lands.

## Alternatives considered

- Do nothing — acceptable only while the recipe set is tiny; the unbounded,
  un-deletable list is the obvious next friction.

## Resolution

`DELETE /recipes/{id}`, `PUT /recipes/{id}`, the matching Convex actions, and
the list's Edit/Delete buttons had already landed ahead of this item (PRs #1 and
#3). What was still open, and what this item closed:

- **Duplicates stay legal.** Importing the same page twice, or keeping two takes
  on "Chili", is a reasonable thing to want, and rejecting the write would be
  worse than the mess. The problem was never that duplicates exist — it is that
  they were invisible. Colliding titles (normalized on trim + case) now carry a
  `Duplicate` badge in the recipe list, with Edit/Delete on each so the user can
  prune. No uniqueness constraint was added.

- **Referential integrity is enforced server-side.** The basket (which doubles
  as the week plan) holds `recipeId` strings that no database can put a foreign
  key on. Cleanup previously lived only in the browser, so it held exactly as
  long as the tab did. `recipes.remove` / `recipes.update` now reconcile the
  basket inside the Convex action, so a second tab, a future mobile client, or
  an e2e script get the same guarantee. It is deliberately best-effort: the
  recipe-service write has already committed, so a failing basket write must not
  turn a successful delete into a thrown action — that is the cross-store
  inconsistency BL-0015 fixed.

- **Grocery-list lines survive a deleted recipe, on purpose.** Lines are an
  aggregate shopping intent, not a recipe reference — there is no back-pointer
  to cascade, and deleting a recipe mid-shop should not silently remove items
  from a list you are standing in a store holding. Regeneration already skips
  (and logs) unresolvable recipe ids.

- **Catalog recipes are immune.** `cat-*` recipes are owned by the sentinel
  catalog user and shared by everyone, so the user-scoped `WHERE` on delete and
  update is load-bearing: a user attempting either gets a 404 and the row
  survives. Tests pin this, so the "resolve against the catalog too" convenience
  that grocery-list aggregation needed is never copied onto the write paths,
  where it would let one user delete a recipe out from under everyone else.

Pagination/search on the list is still deferred (see the catalog work in
BL-0020 for the search pattern to reuse).
