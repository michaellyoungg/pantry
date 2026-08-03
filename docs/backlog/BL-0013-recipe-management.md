---
id: BL-0013
title: Recipe management — de-dup + delete
status: in-progress
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
