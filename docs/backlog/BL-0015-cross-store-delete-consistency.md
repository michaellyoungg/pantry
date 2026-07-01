---
id: BL-0015
title: Cross-store delete/basket partial-failure consistency
status: done
area: web
effort: S
related_specs: [2026-06-30-web-ui-polish-design.md]
created: 2026-06-30
---

## Context

Surfaced in the BL-0012 (web UI polish) whole-branch review. `RecipeList.onDelete`
runs three steps in sequence across two backends:
`deleteRecipe` (recipe-service HTTP) → `removeFromBasket` (Convex, optimistic) →
`refresh`. If `deleteRecipe` succeeds but `basket.remove` then rejects, the
optimistic basket drop rolls back and the row reappears — now pointing at a
recipe that no longer exists — and `refresh` never runs. The same ordering
existed before the polish work (the old `console.error` version had it too); the
polish branch only made the failure visible via the inline error. The edit-save
path (`updateRecipe` → `updateBasketTitle` → `refresh`) has the same shape.

## Proposal

- Make the cross-store cleanup resilient: on a `basket.remove` failure after a
  successful recipe delete, still `refresh` the recipe list (the recipe *is*
  gone) and either retry the basket removal or surface a targeted "removed the
  recipe but couldn't update the basket" message.
- Consider a small reconciliation: `basket.list` could filter out rows whose
  `recipeId` no longer resolves, so an orphaned row self-heals on next load.
- Alternatively, once real ownership/transactions exist, move the basket cleanup
  server-side so it can't partially fail from the client's perspective.

## Alternatives considered

- Leave as-is — acceptable for the single-user local skeleton (failures are rare
  and now at least visible), but an orphaned basket row referencing a deleted
  recipe is a latent inconsistency worth closing before multi-user.
