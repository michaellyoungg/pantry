# Seeded Recipe Catalog Design Spec

> Ship a curated set of system-owned recipes users can browse and add to their
> meal basket, so the recipe → basket → grocery-list loop is demoable without
> data-entry friction. (BL-0002)

## Goal

Add a small, curated catalog of **system-owned** recipes to recipe-service, a
`GET /catalog` endpoint to browse them, and a "Catalog" panel in the web app
whose recipes can be added to the basket exactly like user-authored recipes.
Catalog recipes are **referenced** by their id from the basket — never copied —
so recipe bodies stay canonical in one place.

## Context

recipe-service (Go + Postgres) is the canonical store for recipe definitions.
Recipes are `recipes` rows carrying a `user_id`; ingredients are structured
`{ quantity, unit, item, note }` in a child table with `ON DELETE CASCADE`.
Today every recipe is owned by the stubbed `DevUserID = "dev-user"`, and
`GET /recipes` lists that user's recipes. Grocery-list aggregation
(`POST /grocery-list { recipeIds }`) loads recipes by id via
`GetRecipesByIDs` — **not** user-scoped — so any recipe id referenced from the
Convex basket already aggregates correctly.

On the Convex side, the basket stores `{ recipeId, title }` entries and a Convex
action calls `POST /grocery-list` with the basket's recipe ids. The web app's
`RecipeList` fetches `GET /recipes` and each row's "Add to basket" calls
`api.basket.add({ recipeId, title })`. Errors surface via `useAsyncAction` +
`ErrorText`. This builds on `main` (recipe CRUD, basket, grocery list, and the
Tailwind UI refresh all merged).

## Decisions (from brainstorming)

- **Reference, don't copy.** Picking a catalog recipe adds `{ recipeId, title }`
  to the basket using the shared catalog id. No user-owned clone; keeps recipe
  bodies canonical.
- **Separate seed CLI.** A `cmd/seed` binary loads the catalog into Postgres,
  decoupled from server boot. Run on demand (compose one-shot or `go run`).
  Postgres-only — a separate process can't populate the server's in-memory
  store, so pure memory-store dev has an empty catalog (documented, accepted).
- **Dedicated `GET /catalog`.** Keeps `GET /recipes` meaning "my recipes";
  the catalog is its own concept with its own client fn.
- **Reserved owner id.** Catalog recipes are owned by `CatalogUserID = "catalog"`
  with stable, human-readable ids (`cat-<slug>`) so re-seeding is idempotent and
  basket references never break.
- **~6 recipes** with deliberately overlapping ingredients so aggregation
  visibly combines lines.

## Section 1 — Ownership model & store upsert

In `internal/recipe/types.go`, add alongside `DevUserID`:
```go
// CatalogUserID owns the shared, system-curated recipe catalog (BL-0002).
const CatalogUserID = "catalog"
```
Catalog recipes are ordinary `recipes` rows with `user_id = "catalog"`, in the
**same** table — no schema change.

Add one idempotent method to the `Store` interface (implemented in both
`MemoryStore` and `PostgresStore`):
```go
UpsertRecipe(ctx context.Context, rec Recipe) error
```
- Insert-or-replace **by id**, using the full `Recipe` (id, userId, title,
  ingredients, createdAt).
- **Postgres:** in a tx, `INSERT INTO recipes ... ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, user_id = EXCLUDED.user_id` — **`created_at` is left
  untouched on conflict** so catalog order stays stable across re-seeds — then
  `DELETE FROM ingredients WHERE recipe_id = $1` and re-insert (mirrors the
  existing `UpdateRecipe` ingredient-replacement).
- **Memory:** set `byID[rec.ID]`; append to `order` only when the id is new so
  ordering is stable on re-upsert.
- On first insert, if `rec.CreatedAt` is zero the store stamps
  `time.Now().UTC().Truncate(time.Microsecond)` (consistent with
  `CreateRecipe`); the seeder does not need to supply timestamps.

## Section 2 — Seed data & loader

**`internal/recipe/catalog.json`** — the curated dataset, embedded via
`go:embed`. Shape (an array; `user_id` is intentionally absent — the seeder
forces it):
```json
[
  {
    "id": "cat-garlic-bread",
    "title": "Garlic Bread",
    "ingredients": [
      { "quantity": 1, "unit": "loaf", "item": "baguette" },
      { "quantity": 4, "unit": "cloves", "item": "garlic", "note": "minced" },
      { "quantity": 0.5, "unit": "cup", "item": "butter" }
    ]
  }
]
```
~6 recipes (e.g. Garlic Bread, Spaghetti Aglio e Olio, Margherita Pizza, Caesar
Salad, Tomato Soup, Roasted Vegetables) sharing ingredients like `garlic`,
`olive oil`, and `onion` so the aggregated grocery list visibly combines lines.

**`internal/recipe/catalog.go`** — parses the embedded bytes into `[]Recipe`,
forcing `UserID = CatalogUserID` on each and validating each entry has a
non-empty `id`, non-empty `title`, and ≥1 ingredient. Exposes something like
`LoadCatalog() ([]Recipe, error)`. Keeping the loader in the `recipe` package
(not `cmd/seed`) makes it unit-testable without a DB.

**`cmd/seed/main.go`** — the CLI entrypoint:
- Reads `DATABASE_URL` (required; exits non-zero with a clear message if unset).
- Connects via `recipe.NewPostgresStore` (which also applies `schema.sql`, so it
  is safe against a fresh database).
- `LoadCatalog()`, then `store.UpsertRecipe` for each; logs
  `seeded N catalog recipes` and exits 0. Any error → log + exit 1.

## Section 3 — `GET /catalog` endpoint & web client

**recipe-service** — in `handler.go`, register `GET /catalog` and add:
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
Reuses the existing `ListRecipes` (ordered by `created_at` = seed order). Returns
`[]` (never null) when the catalog is unseeded. CORS already covers `GET`.

**web** — add to `apps/web/src/lib/recipeService.ts`, mirroring `listRecipes`:
```ts
export async function listCatalog(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/catalog`);
  if (!res.ok) throw new Error(`listCatalog failed: ${res.status}`);
  return (await res.json()) as Recipe[];
}
```
No new shared types — reuses `Recipe` from `@pantry/types`.

## Section 4 — Catalog UI

New `apps/web/src/components/Catalog.tsx`:
- A `Card` titled "Catalog". Loads once on mount via `listCatalog()` into local
  state (catalog is static between seeds — no `refreshKey` wiring).
- Each recipe renders its title and a single **"Add to basket"** `Button`
  (`variant="secondary"`, `size="sm"`) calling
  `run(() => addToBasket({ recipeId: r.id, title: r.title }))`, where
  `addToBasket = useMutation(api.basket.add)` — the same mutation and args as
  `RecipeList`. **No Edit/Delete** (catalog is read-only to users).
- Errors via the existing `useAsyncAction` + `ErrorText` pattern; empty state
  "No catalog recipes yet." when the fetch returns `[]`.

In `apps/web/src/App.tsx`, add `<Catalog />` to the grid (after `RecipeList`),
keeping the responsive 2-column layout.

## Section 5 — docker-compose seed step

- **Dockerfile** (`apps/recipe-service/Dockerfile`): add a second final stage
  building `./cmd/seed` into a `seed`-target image (the existing build stage
  compiles the whole module, so only a new `go build -o /out/seed ./cmd/seed`
  + a `seed` runtime stage with that entrypoint are added; the default
  `recipe-service` image is unchanged).
- **docker-compose.yml**: a new `seed` service using `build.target: seed`, the
  same `DATABASE_URL`, and `depends_on: postgres (service_healthy)`, placed
  under `profiles: [seed]` so a normal `docker compose up` never runs it. Run on
  demand: `docker compose run --rm seed` (or `docker compose --profile seed up
  seed`).
- README: a short "Seed the catalog" note documenting the command and that it
  requires the Postgres-backed stack.

## Section 6 — Testing

- **Go — `UpsertRecipe`** (`store_test.go`, both stores via the existing
  table-driven pattern): upserting a new id inserts it; re-upserting the same id
  updates title + replaces ingredients and leaves exactly one row; `created_at`
  is preserved across re-upsert; a memory-store re-upsert does not duplicate the
  `order` entry.
- **Go — catalog loader** (`catalog_test.go`): `LoadCatalog()` parses the
  embedded JSON, every entry has a non-empty id/title and ≥1 ingredient, ids are
  unique and `cat-`-prefixed, and every `UserID` is `CatalogUserID`.
- **Go — `GET /catalog` handler** (`handler_test.go`): with a memory store
  seeded via `UpsertRecipe`, the endpoint returns those recipes as JSON; with an
  empty store it returns `[]` (not null) and `200`.
- **Web — `listCatalog`** (`recipeService.test.ts`): follows the existing fetch
  test; asserts the URL (`/catalog`) and that a non-ok status throws.
- **Web — `Catalog` component** (`Catalog.test.tsx`): using the existing
  convex-mock + mocked `recipeService` pattern, renders fetched titles and
  clicking "Add to basket" calls the mutation with `{ recipeId, title }`; shows
  the empty state on `[]`.
- **Build gate:** `pnpm --filter @pantry/web build`, `( cd apps/web && pnpm test )`,
  and `( cd apps/recipe-service && go test ./... )`.
- **Manual smoke (controller-run):** with the compose stack up, run
  `docker compose run --rm seed` → the Catalog panel lists the recipes →
  "Add to basket" on two catalog recipes → Generate → the grocery list combines
  their shared ingredients (e.g. garlic) into one summed line.

## Out of scope

- **Ownership guards** on `DELETE`/`PUT /recipes/{id}` — a catalog id is still
  technically mutable via those endpoints; the UI never exposes it, and re-running
  seed restores content. Deferred to BL-0004 (real auth / ownership).
- **Pagination / search** on the catalog — deferred within BL-0002 until the
  catalog grows.
- **Copy-to-my-recipes / editing catalog recipes** — explicitly rejected in
  brainstorming (breaks the canonical single-home boundary).
- Ingredient normalization / unit conversion (BL-0003) — the seed uses
  consistent units so exact-match aggregation already demos well.
