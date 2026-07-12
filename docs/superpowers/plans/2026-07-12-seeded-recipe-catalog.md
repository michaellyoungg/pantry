# Seeded Recipe Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a curated set of system-owned recipes users can browse and add to their meal basket, so the recipe → basket → grocery-list loop is demoable without data-entry friction (BL-0002).

**Architecture:** Catalog recipes are ordinary `recipes` rows owned by a reserved `CatalogUserID = "catalog"`, loaded into Postgres by a standalone `cmd/seed` CLI from an embedded `catalog.json`. recipe-service exposes `GET /catalog`; the web app gets a read-only "Catalog" panel whose recipes are **referenced** (not copied) into the basket via the existing `api.basket.add` mutation.

**Tech Stack:** Go (stdlib `net/http`, `pgx`, `//go:embed`), React 19 + TypeScript, Convex (`@pantry/convex` api), Tailwind primitives (`Card`, `Button`), vitest + jsdom + @testing-library/react, Docker Compose.

## Global Constraints

- **Reserved owner:** `CatalogUserID = "catalog"` (const in `internal/recipe/types.go`, alongside `DevUserID`). Catalog recipes live in the **same** `recipes`/`ingredients` tables — no schema change.
- **Stable ids:** every catalog recipe id is `cat-<slug>` (e.g. `cat-garlic-bread`) so re-seeding is idempotent and basket references never break.
- **Reference, don't copy:** picking a catalog recipe calls `api.basket.add({ recipeId, title })` with the shared catalog id — identical to the user-recipe path. No user-owned clone. No Edit/Delete on catalog recipes.
- **Postgres-only seed:** the `cmd/seed` CLI populates Postgres. A separate process cannot populate the server's in-memory store, so pure memory-store dev has an empty catalog (accepted, documented).
- **`created_at` is preserved on re-upsert** so catalog display order (by `created_at` = seed order) stays stable.
- Endpoints return `[]` (never `null`) when empty. Tests import vitest globals explicitly and assert semantics, not class strings. TDD, one deliverable per task, commit at the end of each task.

---

## File Structure

```
apps/recipe-service/internal/recipe/types.go          # MODIFY: add CatalogUserID
apps/recipe-service/internal/recipe/store.go          # MODIFY: Store.UpsertRecipe + MemoryStore impl
apps/recipe-service/internal/recipe/postgres.go       # MODIFY: PostgresStore.UpsertRecipe
apps/recipe-service/internal/recipe/store_test.go     # MODIFY: memory UpsertRecipe tests
apps/recipe-service/internal/recipe/postgres_test.go  # MODIFY: postgres UpsertRecipe integration test
apps/recipe-service/internal/recipe/catalog.json      # CREATE: curated seed dataset (~6 recipes)
apps/recipe-service/internal/recipe/catalog.go        # CREATE: LoadCatalog()
apps/recipe-service/internal/recipe/catalog_test.go   # CREATE: loader test
apps/recipe-service/cmd/seed/main.go                  # CREATE: seed CLI
apps/recipe-service/internal/recipe/handler.go        # MODIFY: GET /catalog route + handler
apps/recipe-service/internal/recipe/handler_test.go   # MODIFY: GET /catalog tests
apps/web/src/lib/recipeService.ts                     # MODIFY: listCatalog()
apps/web/src/lib/recipeService.test.ts                # MODIFY: listCatalog tests
apps/web/src/components/Catalog.tsx                    # CREATE: Catalog panel
apps/web/src/components/Catalog.test.tsx               # CREATE: Catalog component test
apps/web/src/App.tsx                                   # MODIFY: mount <Catalog />
apps/recipe-service/Dockerfile                         # MODIFY: add seed build target
docker-compose.yml                                     # MODIFY: seed one-shot service (profile)
README.md                                              # MODIFY: "Seed the catalog" note
```

All shell commands below run from the repo root `/Users/michael/Projects/pantry` unless noted.

---

## Task 1: `CatalogUserID` + `UpsertRecipe` store method

**Files:**
- Modify: `apps/recipe-service/internal/recipe/types.go`
- Modify: `apps/recipe-service/internal/recipe/store.go`
- Modify: `apps/recipe-service/internal/recipe/postgres.go`
- Test: `apps/recipe-service/internal/recipe/store_test.go`, `apps/recipe-service/internal/recipe/postgres_test.go`

**Interfaces:**
- Consumes: existing `Recipe`, `Ingredient`, `MemoryStore`, `PostgresStore`, `ErrNotFound`.
- Produces: `const CatalogUserID = "catalog"`; `Store.UpsertRecipe(ctx context.Context, rec Recipe) error` (insert-or-replace by id, preserving `created_at` on conflict), implemented on both stores.

- [ ] **Step 1: Add the `CatalogUserID` constant**

In `apps/recipe-service/internal/recipe/types.go`, add directly below the `DevUserID` const:
```go
// CatalogUserID owns the shared, system-curated recipe catalog (BL-0002).
// Catalog recipes are ordinary recipes rows with this user_id.
const CatalogUserID = "catalog"
```

- [ ] **Step 2: Write the failing memory-store `UpsertRecipe` tests**

Append to `apps/recipe-service/internal/recipe/store_test.go`:
```go
func TestMemoryStore_UpsertInsertsThenReplacesPreservingCreatedAt(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()

	rec := Recipe{
		ID:     "cat-garlic-bread",
		UserID: CatalogUserID,
		Title:  "Garlic Bread",
		Ingredients: []Ingredient{
			{Quantity: 4, Unit: "cloves", Item: "garlic"},
		},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("insert upsert: %v", err)
	}
	first, err := s.GetRecipe(ctx, rec.ID)
	if err != nil {
		t.Fatalf("get after insert: %v", err)
	}
	if first.CreatedAt.IsZero() {
		t.Fatal("expected a stamped CreatedAt on first insert")
	}

	// Re-upsert same id with new title + ingredients.
	rec.Title = "Garlic Bread (v2)"
	rec.Ingredients = []Ingredient{
		{Quantity: 1, Unit: "loaf", Item: "baguette"},
		{Quantity: 6, Unit: "cloves", Item: "garlic"},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("replace upsert: %v", err)
	}
	got, err := s.GetRecipe(ctx, rec.ID)
	if err != nil {
		t.Fatalf("get after replace: %v", err)
	}
	if got.Title != "Garlic Bread (v2)" || len(got.Ingredients) != 2 || got.Ingredients[0].Item != "baguette" {
		t.Fatalf("replace mismatch: %+v", got)
	}
	if !got.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt changed on re-upsert: %v vs %v", got.CreatedAt, first.CreatedAt)
	}

	// Exactly one row, and no duplicate order entry (list returns it once).
	list, _ := s.ListRecipes(ctx, CatalogUserID)
	if len(list) != 1 {
		t.Fatalf("catalog list = %d rows, want 1", len(list))
	}
}

func TestMemoryStore_UpsertRequiresID(t *testing.T) {
	if err := NewMemoryStore().UpsertRecipe(context.Background(), Recipe{UserID: CatalogUserID, Title: "x"}); err == nil {
		t.Fatal("expected an error when id is empty")
	}
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestMemoryStore_Upsert`
Expected: FAIL to compile — `s.UpsertRecipe` undefined.

- [ ] **Step 4: Add `UpsertRecipe` to the interface + `MemoryStore`**

In `apps/recipe-service/internal/recipe/store.go`, add to the `Store` interface (after `UpdateRecipe`):
```go
	UpsertRecipe(ctx context.Context, rec Recipe) error
```
And append the `MemoryStore` implementation (after `GetRecipesByIDs`; `errors`, `time` are already imported):
```go
// UpsertRecipe inserts rec, or replaces the existing row with the same id. On
// replace the original CreatedAt is preserved so catalog ordering stays stable.
func (s *MemoryStore) UpsertRecipe(_ context.Context, rec Recipe) error {
	if rec.ID == "" {
		return errors.New("upsert: recipe id is required")
	}
	if rec.Ingredients == nil {
		rec.Ingredients = []Ingredient{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.byID[rec.ID]; ok {
		rec.CreatedAt = existing.CreatedAt
	} else {
		if rec.CreatedAt.IsZero() {
			rec.CreatedAt = time.Now().UTC().Truncate(time.Microsecond)
		}
		s.order = append(s.order, rec.ID)
	}
	s.byID[rec.ID] = rec
	return nil
}
```

- [ ] **Step 5: Add the `PostgresStore` implementation**

Append to `apps/recipe-service/internal/recipe/postgres.go` (after `UpdateRecipe`; `errors`, `time` are already imported):
```go
// UpsertRecipe inserts rec, or replaces the row with the same id (title, owner,
// and ingredients). created_at is only written on first insert — ON CONFLICT
// leaves the existing value so catalog ordering stays stable across re-seeds.
func (s *PostgresStore) UpsertRecipe(ctx context.Context, rec Recipe) error {
	if rec.ID == "" {
		return errors.New("upsert: recipe id is required")
	}
	ings := rec.Ingredients
	if ings == nil {
		ings = []Ingredient{}
	}
	createdAt := rec.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC().Truncate(time.Microsecond)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO recipes (id, user_id, title, created_at) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title`,
		rec.ID, rec.UserID, rec.Title, createdAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ingredients WHERE recipe_id = $1`, rec.ID); err != nil {
		return err
	}
	for i, ing := range ings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ingredients (recipe_id, position, quantity, unit, item, note)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			rec.ID, i, ing.Quantity, ing.Unit, ing.Item, ing.Note); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 6: Add the Postgres integration test (skipped without a DB)**

Append to `apps/recipe-service/internal/recipe/postgres_test.go`:
```go
func TestPostgres_UpsertReplacesAndPreservesCreatedAt(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec := Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("insert: %v", err)
	}
	first, _ := s.GetRecipe(ctx, rec.ID)

	rec.Title = "Cat X v2"
	rec.Ingredients = []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}, {Quantity: 1, Unit: "loaf", Item: "bread"}}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, _ := s.GetRecipe(ctx, rec.ID)
	if got.Title != "Cat X v2" || len(got.Ingredients) != 2 {
		t.Fatalf("replace mismatch: %+v", got)
	}
	if !got.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt changed: %v vs %v", got.CreatedAt, first.CreatedAt)
	}

	list, _ := s.ListRecipes(ctx, CatalogUserID)
	if len(list) != 1 {
		t.Fatalf("catalog list = %d, want 1", len(list))
	}
}
```

- [ ] **Step 7: Run tests + build**

Run:
```bash
cd apps/recipe-service && go test ./... && go build ./...
```
Expected: PASS. The memory `Upsert` tests pass; the Postgres integration test SKIPs (`PANTRY_TEST_DATABASE_URL` unset); build clean.

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-service/internal/recipe/types.go apps/recipe-service/internal/recipe/store.go apps/recipe-service/internal/recipe/postgres.go apps/recipe-service/internal/recipe/store_test.go apps/recipe-service/internal/recipe/postgres_test.go
git commit -m "feat(recipe-service): CatalogUserID + idempotent UpsertRecipe store method"
```

---

## Task 2: Catalog dataset + loader

**Files:**
- Create: `apps/recipe-service/internal/recipe/catalog.json`
- Create: `apps/recipe-service/internal/recipe/catalog.go`
- Test: `apps/recipe-service/internal/recipe/catalog_test.go`

**Interfaces:**
- Consumes: `Recipe`, `Ingredient`, `CatalogUserID` (Task 1).
- Produces: `LoadCatalog() ([]Recipe, error)` — parses the embedded `catalog.json`, forces `UserID = CatalogUserID`, validates each entry (non-empty id + title, ≥1 ingredient, unique ids).

- [ ] **Step 1: Create the seed dataset**

Create `apps/recipe-service/internal/recipe/catalog.json`. Ingredients share `garlic`/`olive oil`/`onion`/`basil` (with consistent units) so aggregation visibly combines lines:
```json
[
  {
    "id": "cat-garlic-bread",
    "title": "Garlic Bread",
    "ingredients": [
      { "quantity": 1, "unit": "loaf", "item": "baguette" },
      { "quantity": 4, "unit": "cloves", "item": "garlic", "note": "minced" },
      { "quantity": 0.5, "unit": "cup", "item": "butter", "note": "softened" },
      { "quantity": 2, "unit": "tbsp", "item": "parsley", "note": "chopped" }
    ]
  },
  {
    "id": "cat-aglio-e-olio",
    "title": "Spaghetti Aglio e Olio",
    "ingredients": [
      { "quantity": 1, "unit": "lb", "item": "spaghetti" },
      { "quantity": 6, "unit": "cloves", "item": "garlic", "note": "thinly sliced" },
      { "quantity": 4, "unit": "tbsp", "item": "olive oil" },
      { "quantity": 1, "unit": "tsp", "item": "red pepper flakes" },
      { "quantity": 2, "unit": "tbsp", "item": "parsley", "note": "chopped" }
    ]
  },
  {
    "id": "cat-margherita-pizza",
    "title": "Margherita Pizza",
    "ingredients": [
      { "quantity": 1, "unit": "ball", "item": "pizza dough" },
      { "quantity": 1, "unit": "can", "item": "crushed tomatoes" },
      { "quantity": 8, "unit": "oz", "item": "mozzarella" },
      { "quantity": 10, "unit": "leaves", "item": "basil" },
      { "quantity": 2, "unit": "tbsp", "item": "olive oil" }
    ]
  },
  {
    "id": "cat-caesar-salad",
    "title": "Caesar Salad",
    "ingredients": [
      { "quantity": 1, "unit": "head", "item": "romaine" },
      { "quantity": 0.5, "unit": "cup", "item": "parmesan", "note": "grated" },
      { "quantity": 1, "unit": "cup", "item": "croutons" },
      { "quantity": 2, "unit": "cloves", "item": "garlic" },
      { "quantity": 3, "unit": "tbsp", "item": "olive oil" },
      { "quantity": 1, "unit": "whole", "item": "lemon" }
    ]
  },
  {
    "id": "cat-tomato-soup",
    "title": "Tomato Soup",
    "ingredients": [
      { "quantity": 6, "unit": "whole", "item": "tomato" },
      { "quantity": 1, "unit": "whole", "item": "onion" },
      { "quantity": 2, "unit": "cloves", "item": "garlic" },
      { "quantity": 2, "unit": "tbsp", "item": "olive oil" },
      { "quantity": 6, "unit": "leaves", "item": "basil" }
    ]
  },
  {
    "id": "cat-roasted-vegetables",
    "title": "Roasted Vegetables",
    "ingredients": [
      { "quantity": 4, "unit": "whole", "item": "carrot" },
      { "quantity": 3, "unit": "whole", "item": "potato" },
      { "quantity": 1, "unit": "whole", "item": "onion" },
      { "quantity": 3, "unit": "tbsp", "item": "olive oil" },
      { "quantity": 1, "unit": "tbsp", "item": "rosemary" }
    ]
  }
]
```

- [ ] **Step 2: Write the failing loader test**

Create `apps/recipe-service/internal/recipe/catalog_test.go`:
```go
package recipe

import (
	"strings"
	"testing"
)

func TestLoadCatalog_ParsesValidatesAndOwnsAsCatalog(t *testing.T) {
	recs, err := LoadCatalog()
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if len(recs) < 5 {
		t.Fatalf("catalog has %d recipes, want at least 5", len(recs))
	}
	seen := map[string]bool{}
	for _, r := range recs {
		if r.UserID != CatalogUserID {
			t.Fatalf("recipe %q userID = %q, want %q", r.ID, r.UserID, CatalogUserID)
		}
		if !strings.HasPrefix(r.ID, "cat-") {
			t.Fatalf("recipe id %q, want a cat- prefix", r.ID)
		}
		if strings.TrimSpace(r.Title) == "" {
			t.Fatalf("recipe %q has an empty title", r.ID)
		}
		if len(r.Ingredients) == 0 {
			t.Fatalf("recipe %q has no ingredients", r.ID)
		}
		if seen[r.ID] {
			t.Fatalf("duplicate catalog id %q", r.ID)
		}
		seen[r.ID] = true
	}
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestLoadCatalog`
Expected: FAIL to compile — `LoadCatalog` undefined.

- [ ] **Step 4: Implement the loader**

Create `apps/recipe-service/internal/recipe/catalog.go`:
```go
package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

// catalogEntry is the on-disk shape of a curated recipe. user_id is intentionally
// absent from the file — LoadCatalog forces every entry to CatalogUserID.
type catalogEntry struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Ingredients []Ingredient `json:"ingredients"`
}

// LoadCatalog parses the embedded catalog dataset into system-owned recipes,
// validating each entry. It does not touch any store.
func LoadCatalog() ([]Recipe, error) {
	var entries []catalogEntry
	if err := json.Unmarshal(catalogJSON, &entries); err != nil {
		return nil, fmt.Errorf("parse catalog.json: %w", err)
	}
	seen := map[string]bool{}
	out := make([]Recipe, 0, len(entries))
	for i, e := range entries {
		if strings.TrimSpace(e.ID) == "" {
			return nil, fmt.Errorf("catalog entry %d: id is required", i)
		}
		if strings.TrimSpace(e.Title) == "" {
			return nil, fmt.Errorf("catalog entry %q: title is required", e.ID)
		}
		if len(e.Ingredients) == 0 {
			return nil, fmt.Errorf("catalog entry %q: at least one ingredient is required", e.ID)
		}
		if seen[e.ID] {
			return nil, fmt.Errorf("catalog entry %q: duplicate id", e.ID)
		}
		seen[e.ID] = true
		out = append(out, Recipe{
			ID:          e.ID,
			UserID:      CatalogUserID,
			Title:       e.Title,
			Ingredients: e.Ingredients,
		})
	}
	return out, nil
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestLoadCatalog`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-service/internal/recipe/catalog.json apps/recipe-service/internal/recipe/catalog.go apps/recipe-service/internal/recipe/catalog_test.go
git commit -m "feat(recipe-service): embedded catalog dataset + LoadCatalog"
```

---

## Task 3: `cmd/seed` CLI

**Files:**
- Create: `apps/recipe-service/cmd/seed/main.go`

**Interfaces:**
- Consumes: `recipe.NewPostgresStore`, `recipe.LoadCatalog` (Task 2), `recipe.Store.UpsertRecipe` (Task 1).
- Produces: a `seed` binary that reads `DATABASE_URL`, applies the schema (via `NewPostgresStore`), and upserts every catalog recipe.

- [ ] **Step 1: Write the seed CLI**

Create `apps/recipe-service/cmd/seed/main.go`:
```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is required to seed the catalog")
	}

	ctx := context.Background()
	store, err := recipe.NewPostgresStore(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer store.Close()

	recipes, err := recipe.LoadCatalog()
	if err != nil {
		return fmt.Errorf("load catalog: %w", err)
	}
	for _, r := range recipes {
		if err := store.UpsertRecipe(ctx, r); err != nil {
			return fmt.Errorf("upsert %q: %w", r.ID, err)
		}
	}
	log.Printf("seeded %d catalog recipes", len(recipes))
	return nil
}
```

- [ ] **Step 2: Verify it builds and vets**

Run:
```bash
cd apps/recipe-service && go build ./... && go vet ./...
```
Expected: clean (no test — `run()` needs a live DB; it's exercised by the manual smoke after Task 6 and by `LoadCatalog`'s unit test).

- [ ] **Step 3: Commit**

```bash
git add apps/recipe-service/cmd/seed/main.go
git commit -m "feat(recipe-service): cmd/seed CLI to load the catalog into Postgres"
```

---

## Task 4: `GET /catalog` endpoint + web client

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go`
- Test: `apps/recipe-service/internal/recipe/handler_test.go`
- Modify: `apps/web/src/lib/recipeService.ts`
- Test: `apps/web/src/lib/recipeService.test.ts`

**Interfaces:**
- Consumes: `Store.ListRecipes`, `CatalogUserID` (Task 1); `Recipe`, `CreateRecipeRequest` from `@pantry/types`.
- Produces: `GET /catalog` → `[]Recipe` (owner `catalog`); web `listCatalog(): Promise<Recipe[]>`.

- [ ] **Step 1: Write the failing handler tests**

Append to `apps/recipe-service/internal/recipe/handler_test.go` (`io`, `strings`, `context`, `encoding/json`, `net/http` are already imported):
```go
func TestListCatalog_ReturnsCatalogOwnedRecipesOnly(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// A dev-user recipe must NOT leak into the catalog.
	_, _ = store.CreateRecipe(ctx, DevUserID, "Mine", nil)

	resp, err := http.Get(srv.URL + "/catalog")
	if err != nil {
		t.Fatalf("GET /catalog: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].ID != "cat-x" || got[0].UserID != CatalogUserID {
		t.Fatalf("unexpected catalog: %+v", got)
	}
}

func TestListCatalog_EmptySerializesAsEmptyArray(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/catalog")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestListCatalog`
Expected: FAIL — `GET /catalog` is unrouted, so both requests 404 (empty case body is `{"error":...}`, not `[]`).

- [ ] **Step 3: Add the route + handler**

In `apps/recipe-service/internal/recipe/handler.go`, register the route in `NewRouter` (after the `GET /recipes/{id}` line):
```go
	mux.HandleFunc("GET /catalog", h.listCatalog)
```
And add the handler (after `listRecipes`):
```go
func (h *handlers) listCatalog(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), CatalogUserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list catalog")
		return
	}
	writeJSON(w, http.StatusOK, recs)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestListCatalog`
Expected: PASS (both cases).

- [ ] **Step 5: Write the failing `listCatalog` web tests**

In `apps/web/src/lib/recipeService.test.ts`, update the import line to add `listCatalog`:
```ts
import { createRecipe, listRecipes, deleteRecipe, updateRecipe, listCatalog } from "./recipeService";
```
And append inside the `describe("recipeService", ...)` block:
```ts
  it("listCatalog GETs /catalog and returns the array", async () => {
    const recipes = [{ id: "cat-garlic-bread", userId: "catalog", title: "Garlic Bread", ingredients: [], createdAt: "" }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => recipes });
    vi.stubGlobal("fetch", fetchMock);
    const result = await listCatalog();
    expect(result).toEqual(recipes);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/catalog$/);
  });

  it("listCatalog throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(listCatalog()).rejects.toThrow();
  });
```

- [ ] **Step 6: Run to verify failure**

Run: `cd apps/web && pnpm test src/lib/recipeService.test.ts`
Expected: FAIL — `listCatalog` is not exported from `./recipeService`.

- [ ] **Step 7: Implement `listCatalog`**

Append to `apps/web/src/lib/recipeService.ts` (after `updateRecipe`; `Recipe` is already imported):
```ts
export async function listCatalog(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/catalog`);
  if (!res.ok) throw new Error(`listCatalog failed: ${res.status}`);
  return (await res.json()) as Recipe[];
}
```

- [ ] **Step 8: Run to verify pass**

Run: `cd apps/web && pnpm test src/lib/recipeService.test.ts`
Expected: PASS (existing cases + 2 new `listCatalog` cases).

- [ ] **Step 9: Commit**

```bash
git add apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go apps/web/src/lib/recipeService.ts apps/web/src/lib/recipeService.test.ts
git commit -m "feat(recipe-service): GET /catalog endpoint + web listCatalog client"
```

---

## Task 5: Catalog UI panel

**Files:**
- Create: `apps/web/src/components/Catalog.tsx`
- Test: `apps/web/src/components/Catalog.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `listCatalog` (Task 4); `api.basket.add`; existing `Card`, `Button`, `ErrorText`, `useAsyncAction`, `Recipe`.
- Produces: the `Catalog` panel (read-only; each row adds the shared catalog id to the basket).

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/components/Catalog.test.tsx` (mirrors the `RecipeList.test.tsx` mock pattern; the `useMutation` stub resolves so the add-to-basket call succeeds):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { addMock } = vi.hoisted(() => ({ addMock: vi.fn(() => Promise.resolve()) }));

vi.mock("convex/react", () => ({
  useMutation: () => addMock,
}));

vi.mock("../lib/recipeService", () => ({
  listCatalog: vi.fn(),
}));

import { Catalog } from "./Catalog";
import { listCatalog } from "../lib/recipeService";

const CAT = {
  id: "cat-garlic-bread",
  userId: "catalog",
  title: "Garlic Bread",
  ingredients: [],
  createdAt: "",
};

describe("Catalog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders catalog recipes and adds one to the basket by reference", async () => {
    vi.mocked(listCatalog).mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith({ recipeId: "cat-garlic-bread", title: "Garlic Bread" }),
    );
  });

  it("shows an empty state when the catalog is empty", async () => {
    vi.mocked(listCatalog).mockResolvedValue([]);
    render(<Catalog />);
    await screen.findByText(/no catalog recipes/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm test src/components/Catalog.test.tsx`
Expected: FAIL — `./Catalog` does not exist.

- [ ] **Step 3: Implement the Catalog panel**

Create `apps/web/src/components/Catalog.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Recipe } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { listCatalog } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function Catalog() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const addToBasket = useMutation(api.basket.add);
  const { run, error } = useAsyncAction();

  useEffect(() => {
    let active = true;
    listCatalog()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card title="Catalog">
      {recipes.length === 0 && <p className="text-sm text-muted">No catalog recipes yet.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
            >
              Add to basket
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test src/components/Catalog.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Mount the panel in the app**

In `apps/web/src/App.tsx`, add the import (after the `RecipeList` import):
```tsx
import { Catalog } from "./components/Catalog";
```
And add `<Catalog />` to the grid, immediately after `<RecipeList refreshKey={refreshKey} />`:
```tsx
          <RecipeList refreshKey={refreshKey} />
          <Catalog />
```

- [ ] **Step 6: Build + full web test gate**

Run:
```bash
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` clean (confirms `listCatalog` and `api.basket.add` resolve); full vitest suite green (report the actual total).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): Catalog panel — browse seeded recipes into the basket"
```

---

## Task 6: docker-compose seed step + docs

**Files:**
- Modify: `apps/recipe-service/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `seed` binary (Task 3).
- Produces: a `seed`-target image and a `docker compose run --rm seed` one-shot under the `seed` profile.

- [ ] **Step 1: Add the seed build target to the Dockerfile**

Replace the entire contents of `apps/recipe-service/Dockerfile`. The build stage now compiles both binaries; `seed` is placed **before** the `server` stage so `server` stays the default (last) stage — the existing `recipe-service` compose service (no `target`) is unaffected:
```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/recipe-service ./cmd/server
RUN CGO_ENABLED=0 go build -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12:nonroot AS seed
COPY --from=build /out/seed /seed
USER nonroot:nonroot
ENTRYPOINT ["/seed"]

FROM gcr.io/distroless/static-debian12:nonroot AS server
COPY --from=build /out/recipe-service /recipe-service
EXPOSE 8090
USER nonroot:nonroot
ENTRYPOINT ["/recipe-service"]
```

- [ ] **Step 2: Add the seed service to docker-compose**

In `docker-compose.yml`, add a `seed` service after the `recipe-service` service (before `convex-backend`). `profiles: [seed]` keeps it out of a normal `docker compose up`:
```yaml
  seed:
    build:
      context: ./apps/recipe-service
      target: seed
    environment:
      DATABASE_URL: postgres://pantry:pantry@postgres:5432/pantry?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy
    profiles: [seed]
```

- [ ] **Step 3: Verify the images build**

Run:
```bash
docker compose build recipe-service seed
```
Expected: both build successfully. `recipe-service` resolves to the `server` stage (unchanged entrypoint); `seed` builds the seed-target image. (If Docker is unavailable in this environment, report that and defer this step to the manual smoke.)

- [ ] **Step 4: Document the seed step in the README**

In `README.md`, add a short subsection under the local-development instructions (adjust the surrounding heading to match the file):
```markdown
### Seed the catalog

The shared recipe catalog (system-owned browse-and-pick recipes) is loaded by a
one-shot seed job against the Postgres-backed stack:

```bash
docker compose up -d postgres recipe-service
docker compose run --rm seed
```

Re-running is safe — recipes upsert by stable id. The catalog requires Postgres;
running recipe-service with the in-memory store (no `DATABASE_URL`) has an empty
catalog.
```

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/Dockerfile docker-compose.yml README.md
git commit -m "chore(infra): seed image target + docker compose seed one-shot"
```

---

## Manual smoke (controller-run, after Task 6)

Not a task. Bring up the stack and seed:
```bash
docker compose up -d postgres recipe-service
docker compose run --rm seed          # logs "seeded 6 catalog recipes"
curl -s localhost:8090/catalog | head # 6 recipes owned by "catalog"
```
Then with Convex + `pnpm dev` running: the **Catalog** panel lists the 6 recipes → click **Add to basket** on *Spaghetti Aglio e Olio* and *Tomato Soup* → **Generate** → the grocery list combines their shared ingredients into summed lines (garlic `6 + 2 = 8 cloves`, olive oil `4 + 2 = 6 tbsp`). Re-running `docker compose run --rm seed` does not duplicate rows. With recipe-service stopped, the Catalog panel shows its empty state and the console error (fetch rejected), and Add-to-basket surfaces an inline error.

---

## Self-Review

**Spec coverage:**
- §1 Ownership model + `UpsertRecipe` (preserve `created_at`, both stores) → Task 1. ✓
- §2 Seed data (`catalog.json`, ~6 overlapping recipes) + loader (`LoadCatalog`, validation) + `cmd/seed` CLI → Tasks 2–3. ✓
- §3 `GET /catalog` (reuses `ListRecipes(CatalogUserID)`, `[]` not null) + web `listCatalog` → Task 4. ✓
- §4 Catalog UI (read-only, reference via `api.basket.add`, `useAsyncAction`/`ErrorText`, empty state) + App wiring → Task 5. ✓
- §5 docker-compose seed step (multi-target Dockerfile, `seed` profile) + README → Task 6. ✓
- §6 Testing: `UpsertRecipe` idempotency (memory always-run + Postgres integration) → Task 1; loader test → Task 2; `GET /catalog` handler tests → Task 4; `listCatalog` fetch test + `Catalog` component test → Tasks 4–5; build gates in Tasks 1/5; manual smoke above. ✓
- Out-of-scope items (ownership guards on DELETE/PUT, pagination, copy-to-my-recipes) — intentionally not implemented, consistent with the spec.

**Placeholder scan:** every code step shows complete code; every run step shows an exact command + expected result. No TBDs. Suite-count assertions say "report the actual total" where the number depends on unrelated files.

**Type consistency:** `UpsertRecipe(ctx context.Context, rec Recipe) error` is identical in the `Store` interface, both store impls, and all call sites (seed CLI, handler tests). `CatalogUserID` used verbatim across types/loader/handler/tests. `listCatalog(): Promise<Recipe[]>` matches its call sites in `recipeService.test.ts` and `Catalog.tsx`. `api.basket.add({ recipeId, title })` matches the existing `RecipeList` usage and the `Catalog.test.tsx` assertion. Dockerfile stage name `server` is the default (last) stage, so the existing target-less `recipe-service` compose service is unchanged; `seed` service pins `target: seed`.
