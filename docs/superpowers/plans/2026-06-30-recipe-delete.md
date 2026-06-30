# Recipe Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user delete a recipe — a `DELETE /recipes/{id}` endpoint on recipe-service plus a Delete button in the web app that also removes the recipe from the Convex basket.

**Architecture:** recipe-service gains `Store.DeleteRecipe` (MemoryStore + PostgresStore, ingredients cascade) and a `DELETE /recipes/{id}` handler (204/404). The web app's `recipeService.ts` gains `deleteRecipe`, and `RecipeList` gets a Delete button that orchestrates: confirm → delete recipe (recipe-service) → remove from basket (Convex) → refetch. Services stay decoupled; the client coordinates.

**Tech Stack:** Go 1.25 (stdlib `net/http`, pgx), Postgres, React/Vite/TS, Convex (`@pantry/convex` api), vitest.

## Global Constraints

- recipe-service: Go **stdlib `net/http`** routing only; the only third-party dep stays **`jackc/pgx/v5`** — add no new deps. Delete is **by id only** (consistent with `GetRecipe`; no ownership check under the stubbed single-`DevUserID` model).
- `DELETE /recipes/{id}` → **204 No Content** on success; **404** (via `ErrNotFound`) when the id doesn't exist.
- `Store.DeleteRecipe(ctx context.Context, id string) error` returns `ErrNotFound` if absent. Postgres relies on the existing `ON DELETE CASCADE` on `ingredients.recipe_id`.
- Web: recipe types from `@pantry/types`; camelCase. The Delete flow is **client-orchestrated**: `deleteRecipe(id)` then `api.basket.remove({recipeId: id})` (idempotent) then refetch the list. A `window.confirm` guards the action. recipe-service NEVER calls Convex.
- Minimal functional UI (plain button, no styling system).

---

## File Structure

```
apps/recipe-service/internal/recipe/
  store.go            # MODIFY: add DeleteRecipe to Store interface + MemoryStore impl
  store_test.go       # MODIFY: MemoryStore delete tests
  postgres.go         # MODIFY: PostgresStore.DeleteRecipe
  postgres_test.go    # MODIFY: delete-cascades-ingredients integration test
  handler.go          # MODIFY: register + implement DELETE /recipes/{id}
  handler_test.go     # MODIFY: DELETE handler tests (204 / 404)
apps/web/src/
  lib/recipeService.ts        # MODIFY: add deleteRecipe(id)
  lib/recipeService.test.ts   # MODIFY: deleteRecipe vitest
  components/RecipeList.tsx    # MODIFY: Delete button + basket cleanup + refetch
```

---

## Task 1: recipe-service delete (Store + handler, TDD)

**Files:**
- Modify: `apps/recipe-service/internal/recipe/store.go`, `store_test.go`
- Modify: `apps/recipe-service/internal/recipe/postgres.go`, `postgres_test.go`
- Modify: `apps/recipe-service/internal/recipe/handler.go`, `handler_test.go`

**Interfaces:**
- Consumes: existing `Store`, `MemoryStore`, `PostgresStore`, `ErrNotFound`, `NewRouter(store Store)`.
- Produces: `DeleteRecipe(ctx context.Context, id string) error` on the `Store` interface (both impls); `DELETE /recipes/{id}` route → 204/404.

- [ ] **Step 1: Write the failing MemoryStore delete tests**

Append to `apps/recipe-service/internal/recipe/store_test.go`:
```go
func TestMemoryStore_DeleteRemovesRecipe(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, DevUserID, "Toast", nil)

	if err := s.DeleteRecipe(ctx, rec.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}
	list, _ := s.ListRecipes(ctx, DevUserID)
	if len(list) != 0 {
		t.Fatalf("list after delete = %+v, want empty", list)
	}
}

func TestMemoryStore_DeleteMissingReturnsErrNotFound(t *testing.T) {
	if err := NewMemoryStore().DeleteRecipe(context.Background(), "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestMemoryStore_Delete -v`
Expected: FAIL — `s.DeleteRecipe undefined` (method not on Store/MemoryStore yet).

- [ ] **Step 3: Add DeleteRecipe to the Store interface + MemoryStore**

In `apps/recipe-service/internal/recipe/store.go`, add to the `Store` interface (after `GetRecipesByIDs`):
```go
	DeleteRecipe(ctx context.Context, id string) error
```
And add the MemoryStore method (anywhere after `GetRecipesByIDs`):
```go
func (s *MemoryStore) DeleteRecipe(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byID[id]; !ok {
		return ErrNotFound
	}
	delete(s.byID, id)
	for i, oid := range s.order {
		if oid == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	return nil
}
```

- [ ] **Step 4: Run MemoryStore tests to verify pass**

Run: `go test ./internal/recipe/ -run TestMemoryStore_Delete -v`
Expected: PASS (2 cases). (`go build ./...` will still fail until PostgresStore also implements the method — that's Step 6.)

- [ ] **Step 5: Write the failing Postgres cascade integration test**

Append to `apps/recipe-service/internal/recipe/postgres_test.go`:
```go
func TestPostgres_DeleteCascadesIngredients(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteRecipe(ctx, rec.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}

	// ingredients are gone via ON DELETE CASCADE
	var n int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM ingredients WHERE recipe_id = $1", rec.ID).Scan(&n); err != nil {
		t.Fatalf("count ingredients: %v", err)
	}
	if n != 0 {
		t.Fatalf("ingredient rows after delete = %d, want 0", n)
	}

	if err := s.DeleteRecipe(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 6: Implement PostgresStore.DeleteRecipe**

Append to `apps/recipe-service/internal/recipe/postgres.go` (alongside the other methods):
```go
func (s *PostgresStore) DeleteRecipe(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM recipes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
```

- [ ] **Step 7: Run the Postgres integration test**

Run:
```bash
docker run --rm -d --name pantry-del-pg -e POSTGRES_USER=pantry -e POSTGRES_PASSWORD=pantry -e POSTGRES_DB=pantry_test -p 5434:5432 postgres:17
sleep 5
PANTRY_TEST_DATABASE_URL=postgres://pantry:pantry@localhost:5434/pantry_test go test ./internal/recipe/ -run TestPostgres_DeleteCascadesIngredients -v
docker stop pantry-del-pg
```
Expected: PASS. ALWAYS `docker stop pantry-del-pg` even on failure. (Host 5432 is occupied locally — 5434 dodges it.)

- [ ] **Step 8: Write the failing DELETE handler tests**

Append to `apps/recipe-service/internal/recipe/handler_test.go`:
```go
func TestDeleteRecipe_RemovesAndReturns204(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/recipes/"+rec.ID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	// gone afterwards
	get, _ := http.Get(srv.URL + "/recipes/" + rec.ID)
	defer get.Body.Close()
	if get.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after delete = %d, want 404", get.StatusCode)
	}
}

func TestDeleteRecipe_MissingReturns404(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/recipes/nope", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}
```

- [ ] **Step 9: Run to verify failure**

Run: `go test ./internal/recipe/ -run TestDeleteRecipe -v`
Expected: FAIL — the route isn't registered, so DELETE returns 405 (Method Not Allowed) not 204/404.

- [ ] **Step 10: Register + implement the handler, and allow DELETE through CORS**

In `apps/recipe-service/internal/recipe/handler.go`, register the route inside `NewRouter` (next to the other `/recipes` routes):
```go
	mux.HandleFunc("DELETE /recipes/{id}", h.deleteRecipe)
```
Add the handler method (next to `getRecipe`):
```go
func (h *handlers) deleteRecipe(w http.ResponseWriter, r *http.Request) {
	err := h.store.DeleteRecipe(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete recipe")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```
**Also update `WithCORS`** (same file, added in Plan 2b) so a browser DELETE survives the preflight — change the allow-methods line to include `DELETE`:
```go
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
```

- [ ] **Step 11: Strengthen the CORS test to pin DELETE**

In `apps/recipe-service/internal/recipe/handler_test.go`, the existing `TestWithCORS_PreflightReturns204WithHeaders` asserts `Allow-Methods` is non-empty. Tighten that assertion so a future edit can't silently drop DELETE — replace the non-empty check with:
```go
	if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, "DELETE") {
		t.Fatalf("Access-Control-Allow-Methods = %q, want it to include DELETE", got)
	}
```
Add `"strings"` to the test file's imports if not already present.

- [ ] **Step 12: Run the full package suite + build + vet**

Run: `go test ./internal/recipe/ -v && go build ./... && go vet ./...`
Expected: all tests PASS (Postgres tests SKIP without the env var; the strengthened CORS test passes), build + vet clean.

- [ ] **Step 13: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/recipe-service/internal/recipe/store.go apps/recipe-service/internal/recipe/store_test.go apps/recipe-service/internal/recipe/postgres.go apps/recipe-service/internal/recipe/postgres_test.go apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go
git commit -m "feat(recipe-service): DELETE /recipes/{id} (cascades ingredients)"
```

---

## Task 2: web delete UI + client (client-orchestrated basket cleanup)

**Files:**
- Modify: `apps/web/src/lib/recipeService.ts`, `apps/web/src/lib/recipeService.test.ts`
- Modify: `apps/web/src/components/RecipeList.tsx`

**Interfaces:**
- Consumes: `DELETE /recipes/{id}` (Task 1), `@pantry/types`, `api.basket.add`/`api.basket.remove`, `VITE_RECIPE_SERVICE_URL`.
- Produces: `deleteRecipe(id: string): Promise<void>`; a Delete button in `RecipeList` that confirms → deletes → removes from basket → refetches.

- [ ] **Step 1: Write the failing deleteRecipe test**

Append to `apps/web/src/lib/recipeService.test.ts` (inside the existing `describe` block):
```ts
  it("deleteRecipe DELETEs /recipes/{id} and resolves on ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await deleteRecipe("r1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/recipes\/r1$/);
    expect(init.method).toBe("DELETE");
  });

  it("deleteRecipe throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(deleteRecipe("nope")).rejects.toThrow();
  });
```
And add `deleteRecipe` to the existing import at the top of the test file:
```ts
import { createRecipe, listRecipes, deleteRecipe } from "./recipeService";
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm test`
Expected: FAIL — `deleteRecipe` is not exported from `./recipeService`.

- [ ] **Step 3: Implement deleteRecipe**

Append to `apps/web/src/lib/recipeService.ts`:
```ts
export async function deleteRecipe(id: string): Promise<void> {
  const res = await fetch(`${BASE}/recipes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteRecipe failed: ${res.status}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test`
Expected: all recipe-client tests PASS (the 3 existing + 2 new).

- [ ] **Step 5: Add the Delete button + basket cleanup to RecipeList**

Replace the entire contents of `apps/web/src/components/RecipeList.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { Recipe } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { deleteRecipe, listRecipes } from "../lib/recipeService";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove);

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
              <button onClick={() => onDelete(r)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Build + test (automated gate)**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` succeed (catches any Convex api / type misuse); vitest passes (5 recipe-client cases).

- [ ] **Step 7: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/lib/recipeService.ts apps/web/src/lib/recipeService.test.ts apps/web/src/components/RecipeList.tsx
git commit -m "feat(web): delete recipe with client-orchestrated basket cleanup"
```

---

## Manual browser smoke (controller-run, after Task 2)

Not a task — the controller runs this against the live stack (like Plan 2b): create a recipe, add it to the basket, click **Delete** → confirm → it disappears from **Recipes** AND **Basket**; Generate no longer includes it. The browser DELETE should succeed with no CORS error in the console (Task 1 Step 10 adds `DELETE` to the allowed methods). Note: the running `recipe-service` container must be rebuilt (`docker compose up -d --build recipe-service`) to pick up the new endpoint + CORS change before the smoke.

---

## Self-Review

**Spec coverage:**
- `DELETE /recipes/{id}` → 204/404 → Task 1 (handler). ✓
- `Store.DeleteRecipe` returns `ErrNotFound`; MemoryStore + PostgresStore; ingredients cascade → Task 1. ✓
- `deleteRecipe(id)` client; throws on non-ok → Task 2. ✓
- Delete button → confirm → delete → `api.basket.remove` → refetch → Task 2. ✓
- Tests: MemoryStore delete, handler 204/404, Postgres cascade, web deleteRecipe → Tasks 1-2. ✓
- Out of scope (edit, dedup-prevention, undo) correctly absent. ✓

**Placeholder scan:** complete code in every step; exact commands + expected output. No TBDs.

**Type consistency:** `DeleteRecipe(ctx, id) error` identical across the interface, MemoryStore, PostgresStore, and the handler call; `deleteRecipe(id: string): Promise<void>`; `api.basket.remove({recipeId})` matches Plan 2a.

**⚠️ Gap found during self-review — CORS did not allow DELETE.** The Plan 2b CORS middleware sets `Access-Control-Allow-Methods: GET, POST, OPTIONS`; a browser `DELETE` would be blocked at preflight. **Resolved in Task 1, Step 10** (add `DELETE` to `WithCORS`'s allowed methods) **and pinned by a test in Step 11** (assert the preflight `Allow-Methods` includes `DELETE`). Without this the endpoint is correct but the browser smoke fails at preflight.
