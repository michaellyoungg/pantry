# Recipe Edit Design Spec

> Backlog: [BL-0013](../../backlog/BL-0013-recipe-management.md) — recipe management
> (de-dup + delete). Delete shipped in PR #1; this spec covers the **edit** half.
> De-dup is explicitly deferred.

## Goal

Let a user edit an existing recipe's title and ingredients, keeping the Convex
basket's title snapshot in sync when an in-basket recipe is renamed.

## Context

`recipe-service` already has create/list/get/delete over a `Store` interface
(`MemoryStore` + `PostgresStore`). Ingredients are stored as a positional set
hanging off a recipe (`ON DELETE CASCADE`). The web app has a `RecipeForm`
(create) panel and a `RecipeList` with per-row Add-to-basket / Delete buttons.
The Convex `basket` table stores a **title snapshot** per `(userId, recipeId)`;
`basket.add` is idempotent on `recipeId` and does not refresh a stale title.

## Decisions

- **Scope:** edit only. Duplicate-title handling stays out (duplicates remain legal).
- **HTTP semantics:** `PUT /recipes/{id}` — **full replacement** of title +
  ingredients (mirrors the create payload; ingredients are already a replace-set).
- **Edit UX:** a dedicated `RecipeEditDialog` using the browser-native
  `<dialog>` element (real modal overlay, zero new deps, free focus-trap/Esc).
  An **Edit** button per row opens it pre-filled.
- **Basket sync:** client-orchestrated. After a successful edit, call a new
  idempotent Convex mutation `basket.updateTitle({recipeId, title})`. Consistent
  with how delete cleans up the basket. recipe-service never calls Convex.

## Section 1 — recipe-service: `PUT /recipes/{id}`

**Route:** `PUT /recipes/{id}`
- **200** with the updated `Recipe` JSON on success.
- **404** (`ErrNotFound`) when the id doesn't exist.
- **400** when `title` is blank after trim (same validation as create).
- The request body is the same shape as create: `{ title, ingredients }`.

**Store interface:** add
```go
UpdateRecipe(ctx context.Context, id, title string, ings []Ingredient) (Recipe, error)
```
to `Store`, `MemoryStore`, and `PostgresStore`.

- **MemoryStore:** look up by id under the mutex (absent → `ErrNotFound`).
  Replace `Title` and `Ingredients` (nil ings → empty slice, as create does);
  **preserve `UserID`, `ID`, and `CreatedAt`**; keep the recipe's position in
  `order`. Return the updated recipe.
- **PostgresStore:** in a transaction —
  - `UPDATE recipes SET title = $1 WHERE id = $2` — `RowsAffected() == 0` →
    `ErrNotFound` (and roll back).
  - `DELETE FROM ingredients WHERE recipe_id = $1`.
  - Re-insert ingredients by position (same INSERT as create).
  - Commit, then re-read via `GetRecipe` (or construct) to return the recipe with
    its preserved `created_at`/`user_id`.

**CORS:** add `PUT` to `WithCORS`'s `Access-Control-Allow-Methods` (same preflight
gap fixed for DELETE) so a browser `PUT` survives preflight. Pinned by the
existing preflight test (assert it contains `PUT`).

## Section 2 — Convex: basket title sync

New mutation in `packages/convex/convex/basket.ts`:
```ts
export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) =>
        q.eq("userId", DEV_USER_ID).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { title });
  },
});
```
Idempotent: no-op when the recipe isn't in the basket. Mirrors `remove`.

## Section 3 — web: edit client + `<dialog>` modal

- **`recipeService.ts`:** `updateRecipe(id: string, body: CreateRecipeRequest): Promise<Recipe>`
  — `PUT ${BASE}/recipes/${id}` with a JSON body; throw on non-ok; return the
  parsed `Recipe`.
- **`RecipeEditDialog`** (new component): renders a native `<dialog>` pre-filled
  with the recipe's title + ingredient rows (same row-editing markup as
  `RecipeForm` — quantity / unit / item, `+ ingredient`). Save and Cancel buttons.
  Props: the recipe being edited and `onSaved` / `onClose` callbacks. Filters out
  blank-item ingredient rows on save (as create does).
- **`RecipeList`:** add an **Edit** button per row that opens the dialog for that
  recipe. On Save it orchestrates: `updateRecipe(id, …)` →
  `basket.updateTitle({recipeId, title})` → refetch list → close dialog. Cancel
  just closes. Errors logged via `console.error` (richer error UI is BL-0012).

## Testing

- **Go:**
  - MemoryStore: update succeeds and preserves `CreatedAt`/`UserID`; updating a
    missing id → `ErrNotFound`.
  - Handler: 200 (body reflects new title/ingredients), 404 (missing), 400
    (blank title).
  - Postgres integration: editing replaces ingredients (old rows gone, new rows
    present, `created_at` unchanged).
- **Web (vitest):** `updateRecipe` PUTs to `/recipes/{id}` with method `PUT` and
  resolves the parsed recipe; throws on a non-ok response.
- **Manual browser smoke (controller-run):** add a recipe to the basket, edit its
  title via the dialog → the new title shows in **both** Recipes and Basket, no
  CORS error. Requires rebuilding the running `recipe-service` container to pick
  up the new endpoint + CORS change.

## Out of scope

- De-dup / duplicate-title warnings (duplicates stay legal).
- Optimistic updates and inline error surfacing (BL-0012).
- Recipe ownership / multi-user (still single stubbed `DevUserID`).
