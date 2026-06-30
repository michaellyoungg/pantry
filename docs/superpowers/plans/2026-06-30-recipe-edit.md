# Recipe Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit an existing recipe's title and ingredients — a `PUT /recipes/{id}` endpoint on recipe-service plus a native-`<dialog>` Edit modal in the web app that also keeps the recipe's title in sync in the Convex basket.

**Architecture:** recipe-service gains `Store.UpdateRecipe` (MemoryStore + PostgresStore; full title+ingredients replacement) and a `PUT /recipes/{id}` handler (200/404/400). Convex gains an idempotent `basket.updateTitle` mutation. The web app's `recipeService.ts` gains `updateRecipe`; a new `RecipeEditDialog` (browser `<dialog>`) edits a recipe; `RecipeList` gets an Edit button that orchestrates: edit recipe (recipe-service) → update basket title (Convex) → refetch. Services stay decoupled; the client coordinates.

**Tech Stack:** Go 1.25 (stdlib `net/http`, pgx), Postgres, React/Vite/TS, Convex (`@pantry/convex` api), vitest.

## Global Constraints

- recipe-service: Go **stdlib `net/http`** routing only; the only third-party dep stays **`jackc/pgx/v5`** — add no new deps. Edit is **by id only** (consistent with `GetRecipe`/`DeleteRecipe`; no ownership check under the stubbed single-`DevUserID` model).
- `PUT /recipes/{id}` → **200** with the updated `Recipe` JSON on success; **404** (via `ErrNotFound`) when the id doesn't exist; **400** when `title` is blank after trim. Body shape is the same as create: `{ title, ingredients }`.
- `Store.UpdateRecipe(ctx, id, title string, ings []Ingredient) (Recipe, error)` returns `ErrNotFound` if absent; **preserves `ID`, `UserID`, `CreatedAt`** and replaces title + ingredients. Postgres replaces ingredient rows inside a transaction.
- Web: recipe types from `@pantry/types`; camelCase. The edit flow is **client-orchestrated**: `updateRecipe(id, body)` then `api.basket.updateTitle({recipeId: id, title})` (idempotent) then refetch the list. recipe-service NEVER calls Convex.
- Convex stores a denormalized basket title; `basket.updateTitle` patches it only when the recipe is in the basket (no-op otherwise). Reuses the existing `by_user_recipe` index and `DEV_USER_ID`.
- Minimal functional UI (plain controls, native `<dialog>`, no styling system). Errors via `console.error` (richer error UI is BL-0012, out of scope).
- After the recipe-service change, the running container must be rebuilt to take effect: `docker compose up -d --build recipe-service` (a plain `up -d` keeps the stale binary).

---

## File Structure

```
apps/recipe-service/internal/recipe/
  store.go            # MODIFY: add UpdateRecipe to Store interface + MemoryStore impl
  store_test.go       # MODIFY: MemoryStore update tests
  postgres.go         # MODIFY: PostgresStore.UpdateRecipe (tx: update title, replace ingredients)
  postgres_test.go    # MODIFY: update-replaces-ingredients integration test
  handler.go          # MODIFY: register + implement PUT /recipes/{id}; allow PUT in CORS
  handler_test.go     # MODIFY: PUT handler tests (200/404/400); pin PUT in CORS test
packages/convex/convex/
  basket.ts           # MODIFY: add updateTitle mutation
apps/web/src/
  lib/recipeService.ts        # MODIFY: add updateRecipe(id, body)
  lib/recipeService.test.ts   # MODIFY: updateRecipe vitest
  components/RecipeEditDialog.tsx  # CREATE: native <dialog> edit form
  components/RecipeList.tsx        # MODIFY: Edit button + dialog wiring + basket title sync + refetch
```

---

## Task 1: recipe-service edit (Store + handler, TDD)

**Files:**
- Modify: `apps/recipe-service/internal/recipe/store.go`, `store_test.go`
- Modify: `apps/recipe-service/internal/recipe/postgres.go`, `postgres_test.go`
- Modify: `apps/recipe-service/internal/recipe/handler.go`, `handler_test.go`

**Interfaces:**
- Consumes: existing `Store`, `MemoryStore`, `PostgresStore`, `ErrNotFound`, `NewRouter(store Store)`, `Ingredient`, `DevUserID`, test helpers `newTestServer(t)` / `newTestPostgres(t)`.
- Produces: `UpdateRecipe(ctx context.Context, id, title string, ings []Ingredient) (Recipe, error)` on the `Store` interface (both impls); `PUT /recipes/{id}` route → 200/404/400.

- [ ] **Step 1: Write the failing MemoryStore update tests**

Append to `apps/recipe-service/internal/recipe/store_test.go`:
```go
func TestMemoryStore_UpdateReplacesFieldsAndPreservesMeta(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	})

	got, err := s.UpdateRecipe(ctx, rec.ID, "French Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" {
		t.Fatalf("title = %q, want French Toast", got.Title)
	}
	if len(got.Ingredients) != 2 || got.Ingredients[0].Item != "brioche" {
		t.Fatalf("ingredients = %+v, want replaced", got.Ingredients)
	}
	if got.ID != rec.ID || got.UserID != rec.UserID || !got.CreatedAt.Equal(rec.CreatedAt) {
		t.Fatalf("meta changed: got id=%s user=%s created=%v", got.ID, got.UserID, got.CreatedAt)
	}
	// the stored copy reflects the update
	reread, _ := s.GetRecipe(ctx, rec.ID)
	if reread.Title != "French Toast" || len(reread.Ingredients) != 2 {
		t.Fatalf("reread = %+v, want updated", reread)
	}
}

func TestMemoryStore_UpdateMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().UpdateRecipe(context.Background(), "nope", "X", nil)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestMemoryStore_Update -v`
Expected: FAIL — `s.UpdateRecipe undefined` (method not on Store/MemoryStore yet).

- [ ] **Step 3: Add UpdateRecipe to the Store interface + MemoryStore**

In `apps/recipe-service/internal/recipe/store.go`, add to the `Store` interface (after `DeleteRecipe`):
```go
	UpdateRecipe(ctx context.Context, id, title string, ings []Ingredient) (Recipe, error)
```
And add the MemoryStore method (anywhere after `DeleteRecipe`):
```go
func (s *MemoryStore) UpdateRecipe(_ context.Context, id, title string, ings []Ingredient) (Recipe, error) {
	if ings == nil {
		ings = []Ingredient{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Recipe{}, ErrNotFound
	}
	rec.Title = title
	rec.Ingredients = ings
	s.byID[id] = rec
	return rec, nil
}
```

- [ ] **Step 4: Run MemoryStore tests to verify pass**

Run: `go test ./internal/recipe/ -run TestMemoryStore_Update -v`
Expected: PASS (2 cases). (`go build ./...` will still fail until PostgresStore also implements the method — that's Step 6.)

- [ ] **Step 5: Write the failing Postgres replace-ingredients integration test**

Append to `apps/recipe-service/internal/recipe/postgres_test.go`:
```go
func TestPostgres_UpdateReplacesIngredients(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.UpdateRecipe(ctx, rec.ID, "French Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" || len(got.Ingredients) != 2 {
		t.Fatalf("update result = %+v, want title+2 ingredients", got)
	}
	if !got.CreatedAt.Equal(rec.CreatedAt) || got.UserID != rec.UserID {
		t.Fatalf("meta changed: %+v vs %+v", got, rec)
	}

	// exactly the new ingredient rows persist (old ones replaced)
	reread, err := s.GetRecipe(ctx, rec.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(reread.Ingredients) != 2 || reread.Ingredients[0].Item != "brioche" || reread.Ingredients[1].Item != "egg" {
		t.Fatalf("reread ingredients = %+v, want [brioche egg]", reread.Ingredients)
	}

	if _, err := s.UpdateRecipe(ctx, "nope", "X", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 6: Implement PostgresStore.UpdateRecipe**

Append to `apps/recipe-service/internal/recipe/postgres.go` (alongside the other methods):
```go
func (s *PostgresStore) UpdateRecipe(ctx context.Context, id, title string, ings []Ingredient) (Recipe, error) {
	if ings == nil {
		ings = []Ingredient{}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `UPDATE recipes SET title = $1 WHERE id = $2`, title, id)
	if err != nil {
		return Recipe{}, err
	}
	if tag.RowsAffected() == 0 {
		return Recipe{}, ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ingredients WHERE recipe_id = $1`, id); err != nil {
		return Recipe{}, err
	}
	for i, ing := range ings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ingredients (recipe_id, position, quantity, unit, item, note)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			id, i, ing.Quantity, ing.Unit, ing.Item, ing.Note); err != nil {
			return Recipe{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Recipe{}, err
	}
	return s.GetRecipe(ctx, id)
}
```

- [ ] **Step 7: Run the Postgres integration test**

Run:
```bash
docker run --rm -d --name pantry-edit-pg -e POSTGRES_USER=pantry -e POSTGRES_PASSWORD=pantry -e POSTGRES_DB=pantry_test -p 5434:5432 postgres:17
sleep 5
PANTRY_TEST_DATABASE_URL=postgres://pantry:pantry@localhost:5434/pantry_test go test ./internal/recipe/ -run TestPostgres_UpdateReplacesIngredients -v
docker stop pantry-edit-pg
```
Expected: PASS. ALWAYS `docker stop pantry-edit-pg` even on failure. (Host 5432/5433 are occupied locally — 5434 dodges them.)

- [ ] **Step 8: Write the failing PUT handler tests**

Append to `apps/recipe-service/internal/recipe/handler_test.go`:
```go
func TestUpdateRecipe_ReplacesAndReturns200(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)

	body := bytes.NewBufferString(`{"title":"French Toast","ingredients":[{"quantity":2,"unit":"slices","item":"brioche"}]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Title != "French Toast" || len(got.Ingredients) != 1 || got.Ingredients[0].Item != "brioche" {
		t.Fatalf("body = %+v, want updated title+ingredient", got)
	}
}

func TestUpdateRecipe_MissingReturns404(t *testing.T) {
	srv, _ := newTestServer(t)
	body := bytes.NewBufferString(`{"title":"X","ingredients":[]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/nope", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateRecipe_BlankTitleReturns400(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)
	body := bytes.NewBufferString(`{"title":"   ","ingredients":[]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
```

- [ ] **Step 9: Run to verify failure**

Run: `go test ./internal/recipe/ -run TestUpdateRecipe -v`
Expected: FAIL — the route isn't registered, so PUT returns 405 (Method Not Allowed) not 200/404/400.

- [ ] **Step 10: Register + implement the handler, and allow PUT through CORS**

In `apps/recipe-service/internal/recipe/handler.go`, register the route inside `NewRouter` (next to the other `/recipes/{id}` routes):
```go
	mux.HandleFunc("PUT /recipes/{id}", h.updateRecipe)
```
Add the handler method (next to `deleteRecipe`):
```go
func (h *handlers) updateRecipe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string       `json:"title"`
		Ingredients []Ingredient `json:"ingredients"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	rec, err := h.store.UpdateRecipe(r.Context(), r.PathValue("id"), req.Title, req.Ingredients)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update recipe")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}
```
**Also update `WithCORS`** (same file) so a browser PUT survives the preflight — change the allow-methods line to include `PUT`:
```go
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
```

- [ ] **Step 11: Strengthen the CORS test to pin PUT**

In `apps/recipe-service/internal/recipe/handler_test.go`, the existing `TestWithCORS_PreflightReturns204WithHeaders` asserts `Allow-Methods` contains `DELETE`. Tighten it so PUT is also pinned — replace that single assertion:
```go
	if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, "DELETE") {
		t.Fatalf("Access-Control-Allow-Methods = %q, want it to include DELETE", got)
	}
```
with:
```go
	for _, m := range []string{"PUT", "DELETE"} {
		if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, m) {
			t.Fatalf("Access-Control-Allow-Methods = %q, want it to include %s", got, m)
		}
	}
```

- [ ] **Step 12: Run the full package suite + build + vet**

Run: `go test ./internal/recipe/ -v && go build ./... && go vet ./...`
Expected: all tests PASS (Postgres tests SKIP without the env var; the strengthened CORS test passes), build + vet clean.

- [ ] **Step 13: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/recipe-service/internal/recipe/store.go apps/recipe-service/internal/recipe/store_test.go apps/recipe-service/internal/recipe/postgres.go apps/recipe-service/internal/recipe/postgres_test.go apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go
git commit -m "feat(recipe-service): PUT /recipes/{id} (replace title + ingredients)"
```

---

## Task 2: Convex basket title sync

**Files:**
- Modify: `packages/convex/convex/basket.ts`

**Interfaces:**
- Consumes: `mutation` from `./_generated/server`, `v` from `convex/values`, `DEV_USER_ID` from `./constants`, the existing `by_user_recipe` index on the `basket` table.
- Produces: `api.basket.updateTitle({ recipeId: string, title: string })` — idempotent; patches the basket row's title when present, no-op otherwise. (The generated api types pick this up automatically via `typeof basket`; no codegen needed.)

- [ ] **Step 1: Add the updateTitle mutation**

Append to `packages/convex/convex/basket.ts` (after `remove`):
```ts
export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) =>
        q.eq("userId", DEV_USER_ID).eq("recipeId", recipeId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, { title });
  },
});
```

- [ ] **Step 2: Typecheck the Convex package**

Run: `cd /home/myoung/projects/pantry && pnpm --filter @pantry/convex exec tsc -p convex --noEmit`
Expected: no type errors. (If `@pantry/convex` has no `tsc` script, this direct invocation still typechecks the `convex/` sources against the convex types.)

- [ ] **Step 3: Commit**

```bash
cd /home/myoung/projects/pantry
git add packages/convex/convex/basket.ts
git commit -m "feat(convex): basket.updateTitle mutation for recipe rename sync"
```

---

## Task 3: web edit UI + client (client-orchestrated basket title sync)

**Files:**
- Modify: `apps/web/src/lib/recipeService.ts`, `apps/web/src/lib/recipeService.test.ts`
- Create: `apps/web/src/components/RecipeEditDialog.tsx`
- Modify: `apps/web/src/components/RecipeList.tsx`

**Interfaces:**
- Consumes: `PUT /recipes/{id}` (Task 1), `api.basket.updateTitle` (Task 2), `@pantry/types` (`Recipe`, `Ingredient`, `CreateRecipeRequest`), `api.basket.add`/`api.basket.remove`, `listRecipes`/`deleteRecipe` (existing), `VITE_RECIPE_SERVICE_URL`.
- Produces: `updateRecipe(id: string, body: CreateRecipeRequest): Promise<Recipe>`; `RecipeEditDialog` component; an Edit button in `RecipeList` that opens the dialog and, on save, updates → syncs basket title → refetches.

- [ ] **Step 1: Write the failing updateRecipe test**

Append to `apps/web/src/lib/recipeService.test.ts` (inside the existing `describe` block):
```ts
  it("updateRecipe PUTs /recipes/{id} and returns the updated recipe", async () => {
    const updated = { id: "r1", userId: "dev-user", title: "French Toast", ingredients: [], createdAt: "" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateRecipe("r1", { title: "French Toast", ingredients: [] });
    expect(result).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/recipes\/r1$/);
    expect(init.method).toBe("PUT");
  });

  it("updateRecipe throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(updateRecipe("nope", { title: "X", ingredients: [] })).rejects.toThrow();
  });
```
And add `updateRecipe` to the existing import at the top of the test file:
```ts
import { createRecipe, listRecipes, deleteRecipe, updateRecipe } from "./recipeService";
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm test`
Expected: FAIL — `updateRecipe` is not exported from `./recipeService`.

- [ ] **Step 3: Implement updateRecipe**

Append to `apps/web/src/lib/recipeService.ts`:
```ts
export async function updateRecipe(id: string, body: CreateRecipeRequest): Promise<Recipe> {
  const res = await fetch(`${BASE}/recipes/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updateRecipe failed: ${res.status}`);
  return (await res.json()) as Recipe;
}
```
(`CreateRecipeRequest` and `Recipe` are already imported at the top of the file.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test`
Expected: all recipe-client tests PASS (the 5 existing + 2 new = 7).

- [ ] **Step 5: Create the RecipeEditDialog component**

Create `apps/web/src/components/RecipeEditDialog.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeEditDialog({
  recipe,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  onSave: (title: string, ingredients: Ingredient[]) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(recipe.title);
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave(title.trim(), ingredients.filter((ing) => ing.item.trim() !== ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onCancel={onClose} onClose={onClose}>
      <form onSubmit={submit}>
        <h2>Edit recipe</h2>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        {ingredients.map((ing, i) => (
          <div key={i} className="ingredient-row">
            <input
              type="number"
              value={ing.quantity}
              onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              style={{ width: "4rem" }}
            />
            <input placeholder="unit" value={ing.unit} onChange={(e) => update(i, { unit: e.target.value })} />
            <input placeholder="item" value={ing.item} onChange={(e) => update(i, { item: e.target.value })} />
          </div>
        ))}
        <button type="button" onClick={() => setIngredients((p) => [...p, emptyIngredient()])}>
          + ingredient
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 6: Wire the Edit button + basket title sync into RecipeList**

Replace the entire contents of `apps/web/src/components/RecipeList.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { deleteRecipe, listRecipes, updateRecipe } from "../lib/recipeService";
import { RecipeEditDialog } from "./RecipeEditDialog";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove);
  const updateBasketTitle = useMutation(api.basket.updateTitle);

  const refresh = useCallback(async () => {
    try {
      setRecipes(await listRecipes());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let active = true;
    listRecipes()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function onDelete(r: Recipe) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    try {
      await deleteRecipe(r.id);
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
      await refresh();
    } catch (e) {
      console.error(e);
    }
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[]) {
    if (!editing) return;
    const id = editing.id;
    try {
      await updateRecipe(id, { title, ingredients });
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
      await refresh();
      setEditing(null);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="panel">
      <h2>Recipes</h2>
      {recipes.length === 0 && <p>No recipes yet.</p>}
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <span>
              <button onClick={() => addToBasket({ recipeId: r.id, title: r.title })}>Add to basket</button>
              <button onClick={() => setEditing(r)}>Edit</button>
              <button onClick={() => onDelete(r)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Build + test (automated gate)**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` succeed (catches any Convex api / type misuse — confirms `api.basket.updateTitle` resolves); vitest passes (7 recipe-client cases).

- [ ] **Step 8: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/lib/recipeService.ts apps/web/src/lib/recipeService.test.ts apps/web/src/components/RecipeEditDialog.tsx apps/web/src/components/RecipeList.tsx
git commit -m "feat(web): edit recipe via dialog with basket title sync"
```

---

## Manual browser smoke (controller-run, after Task 3)

Not a task — the controller runs this against the live stack. **First rebuild the running container** so it serves the new endpoint + CORS (`PUT`): `docker compose up -d --build recipe-service`. Then: create a recipe, add it to the basket, click **Edit** → change the title (and an ingredient) → **Save**. The dialog closes; the new title shows in **Recipes** AND **Basket**; the PUT preflight succeeds with no CORS error in the console. (Convex `updateTitle` is picked up automatically — no `convex dev` redeploy needed for the web typecheck, but the running Convex deployment must have the function; if the smoke shows a stale basket title, run `pnpm --filter @pantry/convex exec convex dev --once` to push functions.)

---

## Self-Review

**Spec coverage:**
- `PUT /recipes/{id}` → 200/404/400 → Task 1 (handler). ✓
- `Store.UpdateRecipe` preserves ID/UserID/CreatedAt, replaces title+ingredients; MemoryStore + PostgresStore; Postgres replaces ingredient rows in a tx → Task 1. ✓
- CORS allows `PUT`, pinned by test → Task 1 Steps 10-11. ✓
- `basket.updateTitle` idempotent mutation → Task 2. ✓
- `updateRecipe(id, body)` client; throws on non-ok; returns Recipe → Task 3. ✓
- `RecipeEditDialog` native `<dialog>`, pre-filled, Save/Cancel → Task 3. ✓
- Edit button → open dialog → updateRecipe → `api.basket.updateTitle` → refetch → close → Task 3. ✓
- Tests: MemoryStore update, handler 200/404/400, Postgres replace, web updateRecipe → Tasks 1-3. ✓
- Out of scope (de-dup, optimistic updates/error UI, ownership) correctly absent. ✓

**Placeholder scan:** complete code in every step; exact commands + expected output. No TBDs.

**Type consistency:** `UpdateRecipe(ctx, id, title string, ings []Ingredient) (Recipe, error)` identical across the interface, MemoryStore, PostgresStore, and the handler call; `updateRecipe(id: string, body: CreateRecipeRequest): Promise<Recipe>`; `api.basket.updateTitle({recipeId, title})` matches Task 2's `{ recipeId: v.string(), title: v.string() }`; `RecipeEditDialog`'s `onSave(title, ingredients)` matches `onSaveEdit(title, ingredients)` in RecipeList.

**Note carried from delete plan:** the running recipe-service container must be rebuilt (`docker compose up -d --build recipe-service`) — a plain `up -d` keeps the stale binary, which is exactly what caused the DELETE-preflight CORS failure observed mid-development.
