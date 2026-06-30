# Recipe Delete — Design

- **Date:** 2026-06-30
- **Status:** Approved
- **Author:** myoung (with Claude)
- **Backlog:** BL-0013 (delete portion; edit + dedup-prevention remain deferred)

## Goal

Let a user remove a recipe. The Recipes list currently grows unbounded with no
way to delete junk/duplicate entries — this fixes that. **Delete only**; edit
and duplicate-prevention are explicitly out of scope.

## Decisions

- **Delete-only.** No edit, no create-time duplicate prevention. Duplicates stay
  legal; delete is how you clean them up.
- **Client-orchestrated basket cleanup.** Deleting a recipe that's in the basket
  also removes it from the basket. The web app (which holds both connections)
  does this: `DELETE /recipes/{id}` on recipe-service, then
  `api.basket.remove({recipeId})` on Convex. recipe-service never calls Convex —
  services stay decoupled. The existing "aggregate skips missing recipe ids"
  behavior remains as a safety net.
- **Confirm prompt.** A minimal `window.confirm` guards the destructive action.

## recipe-service (Go)

- **Route:** `DELETE /recipes/{id}` → `204 No Content` on success; `404` (via
  `ErrNotFound`) if the id doesn't exist. Stdlib routing (`mux.HandleFunc("DELETE /recipes/{id}", ...)`).
- **Store interface:** add `DeleteRecipe(ctx context.Context, id string) error`
  → returns `ErrNotFound` if the recipe doesn't exist.
  - `MemoryStore`: remove from the `byID` map and the `order` slice (under lock).
  - `PostgresStore`: `DELETE FROM recipes WHERE id=$1`; ingredients are removed
    by the existing `ON DELETE CASCADE` on `ingredients.recipe_id`. Detect
    not-found via the command tag's `RowsAffected() == 0` → `ErrNotFound`.
- Delete is by id only (consistent with `GetRecipe`, which doesn't check
  ownership either, under the stubbed single-`DevUserID` model).

## web app

- **`recipeService.ts`:** add `deleteRecipe(id: string): Promise<void>` — issues
  `DELETE {BASE}/recipes/{id}`; throws on a non-ok response.
- **`RecipeList`:** a **Delete** button per recipe row. On click:
  1. `window.confirm(\`Delete "${title}"?\`)` — bail if cancelled.
  2. `await deleteRecipe(id)`.
  3. `await removeFromBasket({ recipeId: id })` (Convex `api.basket.remove`;
     idempotent no-op if the recipe wasn't in the basket).
  4. Re-fetch the recipe list (RecipeList re-runs `listRecipes()` to refresh
     itself).
- The basket panel (`useQuery(api.basket.list)`) updates reactively when the
  basket row is removed — no extra wiring.

## Testing

- **Go unit:** `MemoryStore.DeleteRecipe` (existing → gone + subsequent `GetRecipe`
  is `ErrNotFound`; missing → `ErrNotFound`); handler `DELETE /recipes/{id}` →
  `204` for an existing recipe, `404` for a missing one.
- **Go integration (Postgres):** delete a recipe with ingredients → the recipe
  and its ingredient rows are both gone (cascade).
- **Web unit (vitest):** `deleteRecipe` issues a `DELETE` to `/recipes/{id}` and
  throws on a non-ok response.
- **Manual browser smoke:** create a recipe, add it to the basket, delete it →
  it disappears from both Recipes and Basket; Generate no longer includes it.

## Out of scope (deferred)

Edit recipes, duplicate prevention, undo/soft-delete, per-user ownership checks
(arrive with real auth, BL-0004), bulk delete.
