# Recipe-Service Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Pantry monorepo and a dockerized Go `recipe-service` that is the canonical store for recipe definitions and computes the aggregated grocery list.

**Architecture:** A pnpm + Turborepo monorepo with `apps/` and `packages/`. `packages/types` holds the shared TypeScript contract. `apps/recipe-service` is a Go service (stdlib `net/http` routing) over Postgres, exposing recipe CRUD plus a `POST /grocery-list` aggregation endpoint. Auth is stubbed to a fixed dev user. Everything runs locally via `docker compose`.

**Tech Stack:** pnpm 9, Turborepo, TypeScript 5, Node 22 LTS, Go 1.25 (raised from 1.23 by latest pgx deps), Postgres 17, `jackc/pgx/v5`, Docker Compose.

## Global Constraints

- Package manager is **pnpm** (version pinned via `packageManager` field). Never use `npm`/`yarn` for workspace ops.
- Go module path is **`pantry/apps/recipe-service`** (non-URL module path; this is a private monorepo, not `go get`-able). Go version directive **1.25** — the latest `pgx v5` and its `golang.org/x/*` deps require Go ≥ 1.25, consistent with the project's "latest technology" goal. (Earlier tasks scaffolded with `go 1.23`; `go get` in Task 6 raised it to 1.25.0. The Docker base image must match — see Task 7.)
- The recipe-service router uses **Go stdlib `net/http`** pattern routing only. Do **not** add `chi` or any router dependency in this plan.
- The only third-party Go dependency permitted in this plan is **`github.com/jackc/pgx/v5`** (Postgres driver + pool). No ORM, no migration tool.
- Ingredients are structured `{ quantity, unit, item, note? }`. Aggregation is **literal exact-match** on `item`+`unit` (trim + lowercase for the match key); **no** unit conversion or synonym normalization (that is backlog BL-0003).
- Auth is stubbed: a single constant `DevUserID = "dev-user"`. Every recipe is owned by it. Do not build login.
- JSON field names are **camelCase** in all HTTP payloads (`userId`, `createdAt`, `recipeIds`), matching the TypeScript contract.
- Node version floor **22**. TypeScript **strict** mode on.

---

## File Structure

```
pantry/
  package.json                      # root: pnpm workspace + turbo scripts
  pnpm-workspace.yaml
  turbo.json
  .node-version                     # 22
  packages/
    types/
      package.json                  # @pantry/types
      tsconfig.json
      src/index.ts                  # Ingredient, Recipe, GroceryLine, request/response types
  apps/
    recipe-service/
      go.mod
      go.sum
      .env.example
      Dockerfile
      cmd/server/main.go            # wiring: config, pool, store, router, listen
      internal/
        recipe/
          types.go                  # Ingredient, Recipe, GroceryLine, DevUserID
          aggregate.go              # Aggregate(recipes) []GroceryLine  (pure)
          aggregate_test.go
          store.go                  # Store interface + Memory store (test double)
          store_test.go             # Memory store behaviour
          id.go                     # newID() — crypto/rand identifier (no extra dep)
          postgres.go               # PostgresStore (implements Store)
          postgres_test.go          # integration test (skips without PANTRY_TEST_DATABASE_URL)
          schema.sql                # embedded CREATE TABLE IF NOT EXISTS
          handler.go                # NewRouter(store) http.Handler
          handler_test.go           # httptest against Memory store
  docker-compose.yml                # postgres + recipe-service
```

---

## Task 1: Monorepo foundation + shared types package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.node-version`
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `@pantry/types` package exporting `Ingredient`, `Recipe`, `GroceryLine`, `CreateRecipeRequest`, `GroceryListRequest`. Go structs in later tasks mirror these field-for-field (camelCase JSON).

- [ ] **Step 1: Create the workspace + tool config files**

`.node-version`:
```
22
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json` (root):
```json
{
  "name": "pantry",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 2: Create the `@pantry/types` package**

`packages/types/package.json`:
```json
{
  "name": "@pantry/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

`packages/types/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`packages/types/src/index.ts`:
```ts
export interface Ingredient {
  quantity: number;
  unit: string;
  item: string;
  note?: string;
}

export interface Recipe {
  id: string;
  userId: string;
  title: string;
  ingredients: Ingredient[];
  createdAt: string; // ISO-8601
}

export interface GroceryLine {
  item: string;
  unit: string;
  quantity: number;
}

export interface CreateRecipeRequest {
  title: string;
  ingredients: Ingredient[];
}

export interface GroceryListRequest {
  recipeIds: string[];
}
```

- [ ] **Step 3: Install and build**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm install
pnpm --filter @pantry/types build
```
Expected: `pnpm install` completes; build produces `packages/types/dist/index.js` and `index.d.ts`.

- [ ] **Step 4: Verify typecheck passes across the workspace**

Run: `pnpm typecheck`
Expected: PASS (turbo runs `@pantry/types` typecheck, no errors).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .node-version packages/ pnpm-lock.yaml
git commit -m "feat: scaffold pnpm/turbo monorepo with @pantry/types contract"
```

---

## Task 2: recipe-service Go module + domain types + health endpoint

**Files:**
- Create: `apps/recipe-service/go.mod`
- Create: `apps/recipe-service/internal/recipe/types.go`
- Create: `apps/recipe-service/internal/recipe/handler.go`
- Create: `apps/recipe-service/internal/recipe/handler_test.go`
- Create: `apps/recipe-service/cmd/server/main.go`

**Interfaces:**
- Consumes: nothing from Go yet; mirrors `@pantry/types`.
- Produces: `recipe.Ingredient`, `recipe.Recipe`, `recipe.GroceryLine`, `recipe.DevUserID`, and `recipe.NewRouter(store Store) http.Handler` (Store added in Task 4 — for this task `NewRouter` takes no store yet; it is widened in Task 5). The router serves `GET /healthz` → `200 {"status":"ok"}`.

- [ ] **Step 1: Initialize the Go module**

Run:
```bash
cd /home/myoung/projects/pantry/apps/recipe-service
go mod init pantry/apps/recipe-service
go mod edit -go=1.23
```
Expected: `go.mod` created with `module pantry/apps/recipe-service` and `go 1.23`.

- [ ] **Step 2: Write the domain types**

`internal/recipe/types.go`:
```go
package recipe

import "time"

// DevUserID is the stubbed owner for all recipes until real auth (BL-0004).
const DevUserID = "dev-user"

type Ingredient struct {
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Item     string  `json:"item"`
	Note     string  `json:"note,omitempty"`
}

type Recipe struct {
	ID          string       `json:"id"`
	UserID      string       `json:"userId"`
	Title       string       `json:"title"`
	Ingredients []Ingredient `json:"ingredients"`
	CreatedAt   time.Time    `json:"createdAt"`
}

type GroceryLine struct {
	Item     string  `json:"item"`
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
}
```

- [ ] **Step 3: Write the failing health-endpoint test**

`internal/recipe/handler_test.go`:
```go
package recipe

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	srv := httptest.NewServer(NewRouter())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status field = %q, want \"ok\"", body["status"])
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `go test ./internal/recipe/ -run TestHealthz -v`
Expected: FAIL — `undefined: NewRouter`.

- [ ] **Step 5: Write the minimal router**

`internal/recipe/handler.go`:
```go
package recipe

import (
	"encoding/json"
	"net/http"
)

// NewRouter builds the HTTP handler. It is widened in a later task to take a Store.
func NewRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 6: Write a minimal main so the binary builds**

`cmd/server/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	addr := os.Getenv("PORT")
	if addr == "" {
		addr = "8080"
	}
	log.Printf("recipe-service listening on :%s", addr)
	if err := http.ListenAndServe(":"+addr, recipe.NewRouter()); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `go test ./internal/recipe/ -run TestHealthz -v` and `go build ./...`
Expected: test PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-service/go.mod apps/recipe-service/cmd apps/recipe-service/internal
git commit -m "feat(recipe-service): Go module, domain types, health endpoint"
```

---

## Task 3: Grocery-list aggregation (pure logic, TDD)

**Files:**
- Create: `apps/recipe-service/internal/recipe/aggregate.go`
- Create: `apps/recipe-service/internal/recipe/aggregate_test.go`

**Interfaces:**
- Consumes: `recipe.Recipe`, `recipe.Ingredient`, `recipe.GroceryLine`.
- Produces: `func Aggregate(recipes []Recipe) []GroceryLine` — combines ingredients by exact `item`+`unit` (trim + lowercase match key), summing quantities, preserving first-seen order. Different units of the same item stay separate.

- [ ] **Step 1: Write the failing tests**

`internal/recipe/aggregate_test.go`:
```go
package recipe

import (
	"reflect"
	"testing"
)

func r(title string, ings ...Ingredient) Recipe {
	return Recipe{Title: title, Ingredients: ings}
}

func TestAggregate_CombinesSameItemAndUnit(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"}),
	})
	want := []GroceryLine{{Item: "garlic", Unit: "cloves", Quantity: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_KeepsDifferentUnitsSeparate(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}),
		r("b", Ingredient{Quantity: 10, Unit: "grams", Item: "garlic"}),
	})
	want := []GroceryLine{
		{Item: "garlic", Unit: "cloves", Quantity: 2},
		{Item: "garlic", Unit: "grams", Quantity: 10},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_MatchIsCaseAndSpaceInsensitive(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 1, Unit: "Cup", Item: " Flour "}),
		r("b", Ingredient{Quantity: 2, Unit: "cup", Item: "flour"}),
	})
	want := []GroceryLine{{Item: "flour", Unit: "cup", Quantity: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_PreservesFirstSeenOrder(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a",
			Ingredient{Quantity: 1, Unit: "", Item: "eggs"},
			Ingredient{Quantity: 1, Unit: "cup", Item: "milk"},
		),
		r("b", Ingredient{Quantity: 2, Unit: "", Item: "eggs"}),
	})
	want := []GroceryLine{
		{Item: "eggs", Unit: "", Quantity: 3},
		{Item: "milk", Unit: "cup", Quantity: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_EmptyInputYieldsEmptySlice(t *testing.T) {
	got := Aggregate(nil)
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/recipe/ -run TestAggregate -v`
Expected: FAIL — `undefined: Aggregate`.

- [ ] **Step 3: Implement `Aggregate`**

`internal/recipe/aggregate.go`:
```go
package recipe

import "strings"

// Aggregate combines ingredients across recipes into grocery lines.
// Matching is literal exact-match on item+unit (trimmed, lowercased).
// No unit conversion or synonym normalization yet (see backlog BL-0003).
func Aggregate(recipes []Recipe) []GroceryLine {
	type key struct{ item, unit string }
	sums := map[key]float64{}
	var order []key

	for _, rec := range recipes {
		for _, ing := range rec.Ingredients {
			k := key{
				item: strings.ToLower(strings.TrimSpace(ing.Item)),
				unit: strings.ToLower(strings.TrimSpace(ing.Unit)),
			}
			if _, seen := sums[k]; !seen {
				order = append(order, k)
			}
			sums[k] += ing.Quantity
		}
	}

	lines := make([]GroceryLine, 0, len(order))
	for _, k := range order {
		lines = append(lines, GroceryLine{Item: k.item, Unit: k.unit, Quantity: sums[k]})
	}
	return lines
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/recipe/ -run TestAggregate -v`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/aggregate.go apps/recipe-service/internal/recipe/aggregate_test.go
git commit -m "feat(recipe-service): grocery-list aggregation with exact item+unit matching"
```

---

## Task 4: Store interface + in-memory implementation

**Files:**
- Create: `apps/recipe-service/internal/recipe/store.go`
- Create: `apps/recipe-service/internal/recipe/store_test.go`

**Interfaces:**
- Consumes: `recipe.Recipe`.
- Produces:
  - `type Store interface` with methods:
    - `CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient) (Recipe, error)`
    - `GetRecipe(ctx context.Context, id string) (Recipe, error)`
    - `ListRecipes(ctx context.Context, userID string) ([]Recipe, error)`
    - `GetRecipesByIDs(ctx context.Context, ids []string) ([]Recipe, error)`
  - `var ErrNotFound = errors.New("recipe not found")`
  - `func NewMemoryStore() *MemoryStore` implementing `Store` (used by handler tests; IDs assigned as incrementing `"r1"`, `"r2"`, …).

- [ ] **Step 1: Write the failing in-memory store test**

`internal/recipe/store_test.go`:
```go
package recipe

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()

	created, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected an assigned ID")
	}
	if created.UserID != DevUserID || created.Title != "Toast" {
		t.Fatalf("unexpected recipe: %+v", created)
	}

	got, err := s.GetRecipe(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID || len(got.Ingredients) != 1 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestMemoryStore_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().GetRecipe(context.Background(), "nope")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_GetRecipesByIDsPreservesRequestOrderAndSkipsMissing(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	a, _ := s.CreateRecipe(ctx, DevUserID, "A", nil)
	b, _ := s.CreateRecipe(ctx, DevUserID, "B", nil)

	got, err := s.GetRecipesByIDs(ctx, []string{b.ID, "missing", a.ID})
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}
	if len(got) != 2 || got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("order/skip wrong: %+v", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/recipe/ -run TestMemoryStore -v`
Expected: FAIL — `undefined: NewMemoryStore`.

- [ ] **Step 3: Implement the Store interface + MemoryStore**

`internal/recipe/store.go`:
```go
package recipe

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var ErrNotFound = errors.New("recipe not found")

type Store interface {
	CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient) (Recipe, error)
	GetRecipe(ctx context.Context, id string) (Recipe, error)
	ListRecipes(ctx context.Context, userID string) ([]Recipe, error)
	GetRecipesByIDs(ctx context.Context, ids []string) ([]Recipe, error)
}

type MemoryStore struct {
	mu     sync.Mutex
	seq    int
	byID   map[string]Recipe
	order  []string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{byID: map[string]Recipe{}}
}

func (s *MemoryStore) CreateRecipe(_ context.Context, userID, title string, ings []Ingredient) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	rec := Recipe{
		ID:          fmt.Sprintf("r%d", s.seq),
		UserID:      userID,
		Title:       title,
		Ingredients: ings,
		CreatedAt:   time.Now().UTC(),
	}
	s.byID[rec.ID] = rec
	s.order = append(s.order, rec.ID)
	return rec, nil
}

func (s *MemoryStore) GetRecipe(_ context.Context, id string) (Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Recipe{}, ErrNotFound
	}
	return rec, nil
}

func (s *MemoryStore) ListRecipes(_ context.Context, userID string) ([]Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Recipe{}
	for _, id := range s.order {
		if rec := s.byID[id]; rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, nil
}

func (s *MemoryStore) GetRecipesByIDs(_ context.Context, ids []string) ([]Recipe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Recipe{}
	for _, id := range ids {
		if rec, ok := s.byID[id]; ok {
			out = append(out, rec)
		}
	}
	return out, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/recipe/ -run TestMemoryStore -v`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/store.go apps/recipe-service/internal/recipe/store_test.go
git commit -m "feat(recipe-service): Store interface and in-memory implementation"
```

---

## Task 5: HTTP handlers (CRUD + grocery-list) over the Store

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go` (widen `NewRouter` to take a `Store`)
- Modify: `apps/recipe-service/internal/recipe/handler_test.go` (add CRUD + aggregate tests)
- Modify: `apps/recipe-service/cmd/server/main.go` (pass a store)

**Interfaces:**
- Consumes: `Store`, `Aggregate`, `CreateRecipeRequest`-equivalent JSON, `ErrNotFound`.
- Produces: `func NewRouter(store Store) http.Handler` serving:
  - `GET /healthz`
  - `POST /recipes` — body `{title, ingredients}` → `201` Recipe (owner = `DevUserID`)
  - `GET /recipes` — `200` `[]Recipe` for `DevUserID`
  - `GET /recipes/{id}` — `200` Recipe or `404`
  - `POST /grocery-list` — body `{recipeIds}` → `200` `[]GroceryLine`

- [ ] **Step 1: Replace the health-only test file with the full handler test**

Replace the entire contents of `internal/recipe/handler_test.go`:
```go
package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestServer(t *testing.T) (*httptest.Server, Store) {
	t.Helper()
	store := NewMemoryStore()
	srv := httptest.NewServer(NewRouter(store))
	t.Cleanup(srv.Close)
	return srv, store
}

func TestHealthz(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestCreateRecipe_ReturnsCreatedWithDevOwner(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Toast","ingredients":[{"quantity":2,"unit":"slices","item":"bread"}]}`
	resp, err := http.Post(srv.URL+"/recipes", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("POST /recipes: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID == "" || got.UserID != DevUserID || got.Title != "Toast" || len(got.Ingredients) != 1 {
		t.Fatalf("unexpected recipe: %+v", got)
	}
}

func TestCreateRecipe_RejectsEmptyTitle(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/recipes", "application/json",
		bytes.NewBufferString(`{"title":"","ingredients":[]}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestGetRecipe_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/recipes/nope")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestListRecipes_ReturnsDevUserRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	_, _ = store.CreateRecipe(context.Background(), DevUserID, "A", nil)
	resp, err := http.Get(srv.URL + "/recipes")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	var got []Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Title != "A" {
		t.Fatalf("unexpected list: %+v", got)
	}
}

func TestGroceryList_AggregatesAcrossRecipeIDs(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	a, _ := store.CreateRecipe(ctx, DevUserID, "A", []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}})
	b, _ := store.CreateRecipe(ctx, DevUserID, "B", []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}})

	body, _ := json.Marshal(map[string][]string{"recipeIds": {a.ID, b.ID}})
	resp, err := http.Post(srv.URL+"/grocery-list", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("POST /grocery-list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []GroceryLine{{Item: "garlic", Unit: "cloves", Quantity: 3}}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./internal/recipe/ -run 'TestHealthz|TestCreateRecipe|TestGetRecipe|TestListRecipes|TestGroceryList' -v`
Expected: FAIL — `NewRouter` does not take a `Store` argument / undefined routes.

- [ ] **Step 3: Rewrite the router with the full handler set**

Replace the entire contents of `internal/recipe/handler.go`:
```go
package recipe

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

func NewRouter(store Store) http.Handler {
	h := &handlers{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.healthz)
	mux.HandleFunc("POST /recipes", h.createRecipe)
	mux.HandleFunc("GET /recipes", h.listRecipes)
	mux.HandleFunc("GET /recipes/{id}", h.getRecipe)
	mux.HandleFunc("POST /grocery-list", h.groceryList)
	return mux
}

type handlers struct{ store Store }

func (h *handlers) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) createRecipe(w http.ResponseWriter, r *http.Request) {
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
	rec, err := h.store.CreateRecipe(r.Context(), DevUserID, req.Title, req.Ingredients)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create recipe")
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (h *handlers) listRecipes(w http.ResponseWriter, r *http.Request) {
	recs, err := h.store.ListRecipes(r.Context(), DevUserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list recipes")
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

func (h *handlers) getRecipe(w http.ResponseWriter, r *http.Request) {
	rec, err := h.store.GetRecipe(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not get recipe")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *handlers) groceryList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RecipeIDs []string `json:"recipeIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	recs, err := h.store.GetRecipesByIDs(r.Context(), req.RecipeIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recipes")
		return
	}
	writeJSON(w, http.StatusOK, Aggregate(recs))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
```

- [ ] **Step 4: Update main to construct a store**

Replace the entire contents of `cmd/server/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	store := recipe.NewMemoryStore() // replaced by Postgres store in the next task
	log.Printf("recipe-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, recipe.NewRouter(store)); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 5: Run the full package test suite**

Run: `go test ./internal/recipe/ -v` and `go build ./...`
Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go apps/recipe-service/cmd/server/main.go
git commit -m "feat(recipe-service): recipe CRUD and grocery-list HTTP endpoints"
```

---

## Task 6: Postgres store + schema + integration test

**Files:**
- Create: `apps/recipe-service/internal/recipe/schema.sql`
- Create: `apps/recipe-service/internal/recipe/id.go`
- Create: `apps/recipe-service/internal/recipe/postgres.go`
- Create: `apps/recipe-service/internal/recipe/postgres_test.go`

**Interfaces:**
- Consumes: `Store`, `Recipe`, `Ingredient`, `ErrNotFound`.
- Produces:
  - `func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error)` — connects a pgx pool and applies `schema.sql`.
  - `*PostgresStore` implements `Store`.
  - `func (s *PostgresStore) Close()`.

- [ ] **Step 1: Add the pgx dependency**

Run:
```bash
cd /home/myoung/projects/pantry/apps/recipe-service
go get github.com/jackc/pgx/v5@latest
```
Expected: `go.mod`/`go.sum` updated with `github.com/jackc/pgx/v5`.

- [ ] **Step 2: Write the schema**

`internal/recipe/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingredients (
    id          BIGSERIAL PRIMARY KEY,
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INT  NOT NULL,
    quantity    DOUBLE PRECISION NOT NULL,
    unit        TEXT NOT NULL,
    item        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ingredients_recipe_id_idx ON ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);
```

- [ ] **Step 3: Write the failing integration test**

`internal/recipe/postgres_test.go`:
```go
package recipe

import (
	"context"
	"errors"
	"os"
	"testing"
)

// Integration test: requires a reachable Postgres.
// Run with: PANTRY_TEST_DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry_test go test ./internal/recipe/ -run TestPostgres
func newTestPostgres(t *testing.T) *PostgresStore {
	t.Helper()
	dsn := os.Getenv("PANTRY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PANTRY_TEST_DATABASE_URL to run Postgres integration tests")
	}
	s, err := NewPostgresStore(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(s.Close)
	// Clean slate.
	if _, err := s.pool.Exec(context.Background(), "TRUNCATE ingredients, recipes RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}

func TestPostgres_CreateGetListRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
		{Quantity: 1, Unit: "tbsp", Item: "butter", Note: "softened"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetRecipe(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "Toast" || len(got.Ingredients) != 2 || got.Ingredients[1].Note != "softened" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}

	list, err := s.ListRecipes(ctx, DevUserID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v / %+v", err, list)
	}
}

func TestPostgres_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := newTestPostgres(t).GetRecipe(context.Background(), "nope")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_GetRecipesByIDsPreservesRequestOrder(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	a, _ := s.CreateRecipe(ctx, DevUserID, "A", nil)
	b, _ := s.CreateRecipe(ctx, DevUserID, "B", nil)

	got, err := s.GetRecipesByIDs(ctx, []string{b.ID, "missing", a.ID})
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}
	if len(got) != 2 || got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("order/skip wrong: %+v", got)
	}
}
```

- [ ] **Step 4: Run the integration test to verify it fails to compile/build**

Run: `go test ./internal/recipe/ -run TestPostgres -v`
Expected: FAIL — `undefined: PostgresStore` / `NewPostgresStore`.

- [ ] **Step 5: Add the ID generator (crypto/rand, no new dependency)**

`internal/recipe/id.go`:
```go
package recipe

import (
	"crypto/rand"
	"encoding/hex"
)

// newID returns a random 128-bit hex identifier. Uses crypto/rand so we add no
// third-party dependency (the plan's pgx-only constraint).
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("recipe: crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
```

- [ ] **Step 6: Implement the Postgres store**

`internal/recipe/postgres.go`:
```go
package recipe

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if _, err := pool.Exec(ctx, schemaSQL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() { s.pool.Close() }

func (s *PostgresStore) CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient) (Recipe, error) {
	id := newID()
	createdAt := time.Now().UTC()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO recipes (id, user_id, title, created_at) VALUES ($1,$2,$3,$4)`,
		id, userID, title, createdAt); err != nil {
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
	return Recipe{ID: id, UserID: userID, Title: title, Ingredients: ings, CreatedAt: createdAt}, nil
}

func (s *PostgresStore) GetRecipe(ctx context.Context, id string) (Recipe, error) {
	rec := Recipe{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE id = $1`, id).
		Scan(&rec.ID, &rec.UserID, &rec.Title, &rec.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recipe{}, ErrNotFound
	}
	if err != nil {
		return Recipe{}, err
	}
	ings, err := s.ingredientsFor(ctx, id)
	if err != nil {
		return Recipe{}, err
	}
	rec.Ingredients = ings
	return rec, nil
}

func (s *PostgresStore) ListRecipes(ctx context.Context, userID string) ([]Recipe, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanRecipesWithIngredients(ctx, rows)
}

func (s *PostgresStore) GetRecipesByIDs(ctx context.Context, ids []string) ([]Recipe, error) {
	out := []Recipe{}
	for _, id := range ids {
		rec, err := s.GetRecipe(ctx, id)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, nil
}

func (s *PostgresStore) scanRecipesWithIngredients(ctx context.Context, rows pgx.Rows) ([]Recipe, error) {
	out := []Recipe{}
	for rows.Next() {
		rec := Recipe{}
		if err := rows.Scan(&rec.ID, &rec.UserID, &rec.Title, &rec.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		ings, err := s.ingredientsFor(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Ingredients = ings
	}
	return out, nil
}

func (s *PostgresStore) ingredientsFor(ctx context.Context, recipeID string) ([]Ingredient, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT quantity, unit, item, note FROM ingredients WHERE recipe_id = $1 ORDER BY position`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ings := []Ingredient{}
	for rows.Next() {
		var ing Ingredient
		if err := rows.Scan(&ing.Quantity, &ing.Unit, &ing.Item, &ing.Note); err != nil {
			return nil, err
		}
		ings = append(ings, ing)
	}
	return ings, rows.Err()
}
```

- [ ] **Step 7: Tidy modules**

Run:
```bash
go mod tidy
```
Expected: `github.com/jackc/pgx/v5` is the only third-party dependency in `go.mod` (no `google/uuid` — IDs come from the `crypto/rand` helper in `id.go`).

- [ ] **Step 8: Start Postgres and run the integration test**

Run:
```bash
docker run --rm -d --name pantry-test-pg -e POSTGRES_USER=pantry -e POSTGRES_PASSWORD=pantry -e POSTGRES_DB=pantry_test -p 5432:5432 postgres:17
sleep 3
PANTRY_TEST_DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry_test go test ./internal/recipe/ -run TestPostgres -v
docker stop pantry-test-pg
```
Expected: all `TestPostgres_*` PASS. (Without the env var, these tests SKIP — confirm that too with a plain `go test ./...`.)

- [ ] **Step 9: Commit**

```bash
git add apps/recipe-service/internal/recipe/schema.sql apps/recipe-service/internal/recipe/id.go apps/recipe-service/internal/recipe/postgres.go apps/recipe-service/internal/recipe/postgres_test.go apps/recipe-service/go.mod apps/recipe-service/go.sum
git commit -m "feat(recipe-service): Postgres store with embedded schema and integration tests"
```

---

## Task 7: Wire main to Postgres, Dockerfile, and docker-compose

**Files:**
- Modify: `apps/recipe-service/cmd/server/main.go` (use Postgres when `DATABASE_URL` set)
- Create: `apps/recipe-service/Dockerfile`
- Create: `apps/recipe-service/.env.example`
- Create: `docker-compose.yml` (repo root)

**Interfaces:**
- Consumes: `NewPostgresStore`, `NewMemoryStore`, `NewRouter`.
- Produces: a `docker compose up` stack with `postgres` + `recipe-service`, the service healthy on `:8080`.

- [ ] **Step 1: Wire main to choose Postgres when configured**

Replace the entire contents of `cmd/server/main.go`:
```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"pantry/apps/recipe-service/internal/recipe"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	var store recipe.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pg, err := recipe.NewPostgresStore(context.Background(), dsn)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
		defer pg.Close()
		store = pg
		log.Print("using Postgres store")
	} else {
		store = recipe.NewMemoryStore()
		log.Print("DATABASE_URL unset; using in-memory store")
	}

	log.Printf("recipe-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, recipe.NewRouter(store)); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 2: Add the env example**

`apps/recipe-service/.env.example`:
```
PORT=8080
DATABASE_URL=postgres://pantry:pantry@postgres:5432/pantry?sslmode=disable
```

- [ ] **Step 3: Write the Dockerfile**

`apps/recipe-service/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/recipe-service ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/recipe-service /recipe-service
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/recipe-service"]
```

- [ ] **Step 4: Write docker-compose**

`docker-compose.yml` (repo root):
```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: pantry
      POSTGRES_PASSWORD: pantry
      POSTGRES_DB: pantry
    ports:
      # Host 5433 -> container 5432. 5432 is commonly occupied by other local
      # Postgres containers; the service itself reaches Postgres in-network at
      # postgres:5432 regardless of this host binding.
      - "5433:5432"
    volumes:
      - ./.data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pantry"]
      interval: 3s
      timeout: 3s
      retries: 10

  recipe-service:
    build:
      context: ./apps/recipe-service
    environment:
      PORT: "8080"
      DATABASE_URL: postgres://pantry:pantry@postgres:5432/pantry?sslmode=disable
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 5: Bring the stack up and smoke-test the full loop**

Run:
```bash
cd /home/myoung/projects/pantry
docker compose up --build -d
sleep 5
# health
curl -fsS localhost:8080/healthz
# create two recipes
A=$(curl -fsS -X POST localhost:8080/recipes -H 'content-type: application/json' \
  -d '{"title":"Garlic Bread","ingredients":[{"quantity":2,"unit":"cloves","item":"garlic"}]}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
B=$(curl -fsS -X POST localhost:8080/recipes -H 'content-type: application/json' \
  -d '{"title":"Aioli","ingredients":[{"quantity":1,"unit":"cloves","item":"garlic"}]}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# aggregated grocery list
curl -fsS -X POST localhost:8080/grocery-list -H 'content-type: application/json' \
  -d "{\"recipeIds\":[\"$A\",\"$B\"]}"
echo
docker compose down
```
Expected: health prints `{"status":"ok"}`; the grocery-list call returns `[{"item":"garlic","unit":"cloves","quantity":3}]`.

- [ ] **Step 6: Commit**

```bash
git add apps/recipe-service/cmd/server/main.go apps/recipe-service/Dockerfile apps/recipe-service/.env.example docker-compose.yml
git commit -m "feat(recipe-service): Postgres wiring, Dockerfile, and docker-compose stack"
```

---

## Self-Review

**Spec coverage (against the Milestone 1 design):**
- recipe-service as canonical recipe store → Tasks 2, 4, 6. ✓
- Structured `{quantity, unit, item, note}` ingredients → Task 1 (TS), Task 2 (Go), Task 6 (schema). ✓
- Literal exact-match aggregation, units stay separate → Task 3. ✓
- `POST /grocery-list {recipeIds}` aggregate endpoint → Task 5. ✓
- Stubbed dev user, multi-tenant `user_id` column → Tasks 2, 5, 6. ✓
- Shared TS contract, Go structs hand-mirrored (drift risk noted, BL-0007) → Task 1. ✓
- Local-first docker-compose (Postgres + service) → Task 7. ✓
- Go stdlib routing, pgx-only dependency rule → Global Constraints, Tasks 5–6. ✓
- **Out of scope (correctly absent):** Convex, web app, the Convex action that calls `/grocery-list`, real auth, Railway, catalog, URL import. These belong to Plan 2 / backlog. ✓

**Placeholder scan:** No `TBD`/`TODO`/"add error handling" placeholders; every code step shows complete code; every command lists expected output.

**Type consistency:** `Aggregate(recipes []Recipe) []GroceryLine`, `Store` method signatures, `NewRouter(store Store)`, `NewPostgresStore(ctx, dsn)`, `NewMemoryStore()`, and JSON field names (`recipeIds`, `userId`, `createdAt`) are consistent across Tasks 2–7 and match `@pantry/types` (Task 1). The `note` field is optional in TS (`note?`) and `json:"note,omitempty"` in Go. ✓

**Note carried into Plan 2:** Plan 2's Convex action will `POST` the basket's recipe ids to `recipe-service` `POST /grocery-list` and persist the returned `[]GroceryLine` as the reactive Convex grocery list.
