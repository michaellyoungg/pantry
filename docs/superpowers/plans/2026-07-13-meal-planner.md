# Meal Planner (BL-0018) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat basket into a dinner-first weekly meal plan — assign recipes to days (Sun–Sat), scale servings into grocery quantities, mark leftovers, and generate one aggregated list with non-destructive check-off-preserving regeneration.

**Architecture:** Bottom-up across three layers. (1) Shared contract `@pantry/types` gains grocery-list *items* (id+multiplier). (2) Go recipe-service scales ingredient quantities during aggregation. (3) Convex `basket` becomes plan entries (day/servings/type), regeneration merges instead of replaces, and `generateGroceryList` sends the visible week's meals with multipliers. (4) Web `/plan` renders the week (grid on desktop, agenda on phone).

**Tech Stack:** Go (stdlib net/http), self-hosted Convex + `convex-test`, React 19 + TanStack Router, Tailwind v4, Vitest. No new dependencies.

## Global Constraints

- **Fresh worktree needs deps:** run `pnpm install` once before any test/build (git worktrees don't share `node_modules`), and `pnpm --filter @pantry/types build` before Convex/web typecheck.
- **Contract change is atomic:** `GroceryListRequest` goes from `{ recipeIds: string[] }` to `{ items: { recipeId: string; multiplier: number }[] }` across `@pantry/types`, Go, and Convex. Compile-time `Equals<Infer<validator>, Type>` guards catch drift.
- **Convex codegen after adding functions/schema:** `pnpm --filter @pantry/convex run codegen` so `convex-test`'s `api`/`internal` include new functions. The self-hosted backend is up at `http://127.0.0.1:3210` (required for codegen/typecheck per project memory).
- **Test commands:** Go — `go test ./...` in `apps/recipe-service`. Convex — `pnpm --filter @pantry/convex test`. Web — `pnpm --filter @pantry/web run test <file>` (script form; `pnpm exec vitest` fails to resolve the bin in this monorepo).
- **Domain rules:** week is **Sunday→Saturday**; `plannedDate` is a local `"YYYY-MM-DD"` string (ISO dates compare correctly as strings); `servingsMultiplier` clamps to **≥ 0.25**, default **1**; entry `type` is `"meal" | "leftover"`, default `"meal"`; leftovers and unscheduled entries never enter the grocery list.
- **No jest-dom** in web tests — use `getAttribute`/`textContent`/`toBeNull()`.

---

### Task 1: `@pantry/types` — grocery-list items contract

**Files:**
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `GroceryListItem { recipeId: string; multiplier: number }` and `GroceryListRequest { items: GroceryListItem[] }` (replaces the `recipeIds` shape). Consumed by Convex `recipes.ts` (Task 6) as the request payload contract.

- [ ] **Step 1: Replace the request type**

In `packages/types/src/index.ts`, replace the `GroceryListRequest` interface:

```ts
export interface GroceryListItem {
  recipeId: string;
  multiplier: number;
}

export interface GroceryListRequest {
  items: GroceryListItem[];
}
```

- [ ] **Step 2: Build the package to verify it compiles**

Run: `pnpm --filter @pantry/types build`
Expected: exits 0, emits `dist/index.d.ts` containing `GroceryListItem`.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): grocery-list items (recipeId + multiplier) contract"
```

---

### Task 2: Go — `AggregateScaled`

**Files:**
- Modify: `apps/recipe-service/internal/recipe/aggregate.go`
- Test: `apps/recipe-service/internal/recipe/aggregate_test.go`

**Interfaces:**
- Produces: `type ScaledRecipe struct { Recipe Recipe; Multiplier float64 }` and `func AggregateScaled(entries []ScaledRecipe) []GroceryLine`. `func Aggregate(recipes []Recipe) []GroceryLine` stays as a wrapper (multiplier 1). Consumed by the handler (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `apps/recipe-service/internal/recipe/aggregate_test.go`:

```go
func TestAggregateScaled_MultipliesQuantities(t *testing.T) {
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: r("a", Ingredient{Quantity: 2, Unit: "cloves", Item: "garlic"}), Multiplier: 2},
	})
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 4, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregateScaled_SumsRepeatedRecipeInstances(t *testing.T) {
	rec := r("a", Ingredient{Quantity: 1, Unit: "cloves", Item: "garlic"})
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: rec, Multiplier: 1},
		{Recipe: rec, Multiplier: 2},
	})
	want := []GroceryLine{{Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregateScaled_ScalesConvertibleUnits(t *testing.T) {
	// (4 tbsp + 0.5 cup) butter = 12 tbsp; ×1.5 = 18 tbsp -> 1 1/8 cup = 1.125 cup.
	got := AggregateScaled([]ScaledRecipe{
		{Recipe: r("a", Ingredient{Quantity: 4, Unit: "tbsp", Item: "butter"},
			Ingredient{Quantity: 0.5, Unit: "cup", Item: "butter"}), Multiplier: 1.5},
	})
	want := []GroceryLine{{Item: "Butter", Unit: "cup", Quantity: 1.125, Aisle: "dairy"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestAggregate_WrapperEqualsMultiplierOne(t *testing.T) {
	ings := r("a", Ingredient{Quantity: 3, Unit: "cloves", Item: "garlic"})
	if !reflect.DeepEqual(Aggregate([]Recipe{ings}),
		AggregateScaled([]ScaledRecipe{{Recipe: ings, Multiplier: 1}})) {
		t.Fatal("Aggregate must equal AggregateScaled at multiplier 1")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run AggregateScaled`
Expected: FAIL — `undefined: AggregateScaled` / `undefined: ScaledRecipe`.

- [ ] **Step 3: Implement `AggregateScaled` and rewrite `Aggregate` as a wrapper**

In `apps/recipe-service/internal/recipe/aggregate.go`, replace the function signature line
`func Aggregate(recipes []Recipe) []GroceryLine {` and the loop header so scaling is applied.
Concretely, add the type and new function, and make the old loop iterate scaled entries:

```go
// ScaledRecipe pairs a recipe with a servings multiplier applied to every
// ingredient quantity before aggregation. Multiplier <= 0 is treated as 1.
type ScaledRecipe struct {
	Recipe     Recipe
	Multiplier float64
}

// Aggregate combines ingredients across recipes at multiplier 1.
func Aggregate(recipes []Recipe) []GroceryLine {
	entries := make([]ScaledRecipe, len(recipes))
	for i, rec := range recipes {
		entries[i] = ScaledRecipe{Recipe: rec, Multiplier: 1}
	}
	return AggregateScaled(entries)
}

// AggregateScaled combines ingredients across recipes, scaling each recipe's
// quantities by its multiplier. Canonicalization, unit conversion, aisle
// tagging and sort order match Aggregate.
func AggregateScaled(entries []ScaledRecipe) []GroceryLine {
	type key struct{ item, bucket string }
	type acc struct {
		display string
		aisle   string
		unit    string
		dim     string
		base    float64
	}
	accs := map[key]*acc{}
	var order []key

	for _, e := range entries {
		mult := e.Multiplier
		if mult <= 0 {
			mult = 1
		}
		for _, ing := range e.Recipe.Ingredients {
			canonical, display, aisle := normalizer.CanonicalItem(ing.Item)
			dim, toBase, convertible := normalizer.Unit(ing.Unit)

			var k key
			if convertible {
				k = key{canonical, "d:" + dim}
			} else {
				k = key{canonical, "u:" + strings.ToLower(strings.TrimSpace(ing.Unit))}
			}

			a := accs[k]
			if a == nil {
				a = &acc{display: display, aisle: aisle}
				if convertible {
					a.dim = dim
				} else {
					a.unit = strings.ToLower(strings.TrimSpace(ing.Unit))
				}
				accs[k] = a
				order = append(order, k)
			}
			if convertible {
				a.base += ing.Quantity * mult * toBase
			} else {
				a.base += ing.Quantity * mult
			}
		}
	}

	lines := make([]GroceryLine, 0, len(order))
	for _, k := range order {
		a := accs[k]
		var qty float64
		var unit string
		if a.dim != "" {
			qty, unit = normalizer.Friendly(a.dim, a.base)
		} else {
			qty, unit = snapNice(a.base), a.unit
		}
		lines = append(lines, GroceryLine{Item: a.display, Unit: unit, Quantity: qty, Aisle: a.aisle})
	}

	sort.SliceStable(lines, func(i, j int) bool {
		return normalizer.aisleRank(lines[i].Aisle) < normalizer.aisleRank(lines[j].Aisle)
	})
	return lines
}
```

- [ ] **Step 4: Run the full recipe package tests**

Run: `cd apps/recipe-service && go test ./internal/recipe/`
Expected: PASS (new AggregateScaled tests + all existing Aggregate tests).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/aggregate.go apps/recipe-service/internal/recipe/aggregate_test.go
git commit -m "feat(recipe-service): AggregateScaled applies per-recipe servings multiplier"
```

---

### Task 3: Go — `/grocery-list` accepts `items`

**Files:**
- Modify: `apps/recipe-service/internal/recipe/handler.go` (the `groceryList` handler)
- Test: `apps/recipe-service/internal/recipe/handler_test.go` (create if absent)

**Interfaces:**
- Consumes: `AggregateScaled`, `ScaledRecipe` (Task 2); `store.GetRecipesByIDs(ctx, userID, ids)`.
- Produces: `POST /grocery-list` now accepts `{ "items": [{ "recipeId": "...", "multiplier": 2 }] }` and returns scaled `[]GroceryLine`. Repeated `recipeId`s materialize once per item. Unknown ids are skipped (unchanged behavior).

- [ ] **Step 1: Write the failing test**

Create/append `apps/recipe-service/internal/recipe/handler_test.go`. Use `MemoryStore` and the router; authenticate with the service secret + user header:

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

func TestGroceryList_ScalesByMultiplier(t *testing.T) {
	store := NewMemoryStore()
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Garlic",
		[]Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}})
	router := NewRouter(store, "secret")

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{"recipeId": rec.ID, "multiplier": 2}},
	})
	req := httptest.NewRequest("POST", "/grocery-list", bytes.NewReader(body))
	req.Header.Set("X-Service-Secret", "secret")
	req.Header.Set("X-User-Id", "user-a")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rr.Code, rr.Body.String())
	}
	var lines []GroceryLine
	_ = json.Unmarshal(rr.Body.Bytes(), &lines)
	if len(lines) != 1 || lines[0].Quantity != 4 {
		t.Fatalf("want 4 cloves garlic, got %+v", lines)
	}
}
```

(If `NewMemoryStore`/`CreateRecipe` signatures differ, adjust to the ones in `store.go`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestGroceryList_ScalesByMultiplier`
Expected: FAIL — handler still decodes `recipeIds`, so multiplier is ignored (quantity 2, not 4).

- [ ] **Step 3: Rewrite the `groceryList` handler**

Replace the body of `func (h *handlers) groceryList` in `handler.go`:

```go
func (h *handlers) groceryList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []struct {
			RecipeID   string  `json:"recipeId"`
			Multiplier float64 `json:"multiplier"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ids := make([]string, 0, len(req.Items))
	seen := map[string]bool{}
	for _, it := range req.Items {
		if !seen[it.RecipeID] {
			seen[it.RecipeID] = true
			ids = append(ids, it.RecipeID)
		}
	}
	recs, err := h.store.GetRecipesByIDs(r.Context(), userIDFrom(r.Context()), ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recipes")
		return
	}
	byID := make(map[string]Recipe, len(recs))
	for _, rec := range recs {
		byID[rec.ID] = rec
	}

	entries := make([]ScaledRecipe, 0, len(req.Items))
	for _, it := range req.Items {
		if rec, ok := byID[it.RecipeID]; ok {
			entries = append(entries, ScaledRecipe{Recipe: rec, Multiplier: it.Multiplier})
		}
	}
	writeJSON(w, http.StatusOK, AggregateScaled(entries))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/recipe-service && go test ./internal/recipe/`
Expected: PASS (new handler test + all existing).

- [ ] **Step 5: Commit**

```bash
git add apps/recipe-service/internal/recipe/handler.go apps/recipe-service/internal/recipe/handler_test.go
git commit -m "feat(recipe-service): /grocery-list accepts scaled items"
```

---

### Task 4: Convex — `basket` schema + plan-entry mutations

**Files:**
- Modify: `packages/convex/convex/schema.ts`
- Modify: `packages/convex/convex/basket.ts`
- Test: `packages/convex/convex/basket.test.ts` (create)

**Interfaces:**
- Produces mutations: `add(recipeId, title)` (inserts a new unscheduled meal entry, no dedupe, returns id), `removeEntry(id)`, `assignDay(id, plannedDate: string | null)`, `setServings(id, servingsMultiplier)`, `setType(id, type)`, `remove(recipeId)` (deletes ALL matching), `updateTitle(recipeId, title)` (patches ALL matching). `list()` unchanged. Consumed by web (Tasks 8–9) and `generateGroceryList` (Task 6).

- [ ] **Step 1: Extend the schema**

In `packages/convex/convex/schema.ts`, replace the `basket` table definition:

```ts
  basket: defineTable({
    userId: v.string(),
    recipeId: v.string(),
    title: v.string(),
    plannedDate: v.optional(v.string()), // "YYYY-MM-DD"; absent = unscheduled
    servingsMultiplier: v.optional(v.number()), // absent → 1
    type: v.optional(v.union(v.literal("meal"), v.literal("leftover"))), // absent → "meal"
  })
    .index("by_user", ["userId"])
    .index("by_user_recipe", ["userId", "recipeId"]),
```

- [ ] **Step 2: Rewrite `basket.ts` mutations**

Replace `packages/convex/convex/basket.ts` with:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function requireUser(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("basket")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Adds a new unscheduled meal entry. No dedupe — a recipe can be planned more
// than once (e.g. the same dish on two days).
export const add = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await requireUser(ctx);
    return await ctx.db.insert("basket", {
      userId,
      recipeId,
      title,
      servingsMultiplier: 1,
      type: "meal",
    });
  },
});

async function ownedEntry(
  ctx: Parameters<Parameters<typeof mutation>[0]["handler"]>[0],
  userId: string,
  id: string,
) {
  const row = await ctx.db.get(id as never);
  if (row === null || (row as { userId: string }).userId !== userId) {
    throw new Error("Not found");
  }
  return row;
}

export const removeEntry = mutation({
  args: { id: v.id("basket") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    await ownedEntry(ctx, userId, id);
    await ctx.db.delete(id);
  },
});

export const assignDay = mutation({
  args: { id: v.id("basket"), plannedDate: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, plannedDate }) => {
    const userId = await requireUser(ctx);
    await ownedEntry(ctx, userId, id);
    await ctx.db.patch(id, { plannedDate: plannedDate ?? undefined });
  },
});

export const setServings = mutation({
  args: { id: v.id("basket"), servingsMultiplier: v.number() },
  handler: async (ctx, { id, servingsMultiplier }) => {
    const userId = await requireUser(ctx);
    await ownedEntry(ctx, userId, id);
    await ctx.db.patch(id, { servingsMultiplier: Math.max(0.25, servingsMultiplier) });
  },
});

export const setType = mutation({
  args: { id: v.id("basket"), type: v.union(v.literal("meal"), v.literal("leftover")) },
  handler: async (ctx, { id, type }) => {
    const userId = await requireUser(ctx);
    await ownedEntry(ctx, userId, id);
    await ctx.db.patch(id, { type });
  },
});

// Recipe-delete cleanup: remove ALL entries for a recipe.
export const remove = mutation({
  args: { recipeId: v.string() },
  handler: async (ctx, { recipeId }) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

// Recipe-rename: update the denormalized title on ALL entries for a recipe.
export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .collect();
    for (const row of rows) await ctx.db.patch(row._id, { title });
  },
});
```

> If the `requireUser`/`ownedEntry` helper typings fight Convex's generated context types, inline `const userId = await getAuthUserId(ctx); if (userId === null) throw...` in each handler and fetch/guard the row inline — the existing file already used that inline form. Prefer whichever keeps `pnpm --filter @pantry/convex run codegen` + typecheck green.

- [ ] **Step 3: Regenerate Convex types**

Run: `pnpm --filter @pantry/convex run codegen`
Expected: exits 0; `_generated/api.d.ts` includes `basket.assignDay`, `setServings`, `setType`, `removeEntry`.

- [ ] **Step 4: Write the failing tests**

Create `packages/convex/convex/basket.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("basket plan entries", () => {
  it("add inserts a new unscheduled meal entry each call (no dedupe)", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "meal", servingsMultiplier: 1 });
    expect(rows[0].plannedDate).toBeUndefined();
  });

  it("assignDay, setServings, setType patch a single entry", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.assignDay, { id, plannedDate: "2026-07-14" });
    await asUser.mutation(api.basket.setServings, { id, servingsMultiplier: 2 });
    await asUser.mutation(api.basket.setType, { id, type: "leftover" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows[0]).toMatchObject({
      plannedDate: "2026-07-14",
      servingsMultiplier: 2,
      type: "leftover",
    });
  });

  it("setServings clamps below 0.25", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.setServings, { id, servingsMultiplier: 0 });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows[0].servingsMultiplier).toBe(0.25);
  });

  it("remove(recipeId) deletes all entries for that recipe", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r2", title: "Soup" });
    await asUser.mutation(api.basket.remove, { recipeId: "r1" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeId).toBe("r2");
  });

  it("updateTitle(recipeId) renames all entries for that recipe", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.updateTitle, { recipeId: "r1", title: "Fish Tacos" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows.every((r) => r.title === "Fish Tacos")).toBe(true);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @pantry/convex test basket`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/schema.ts packages/convex/convex/basket.ts packages/convex/convex/basket.test.ts packages/convex/convex/_generated
git commit -m "feat(convex): basket becomes plan entries (day/servings/type)"
```

---

### Task 5: Convex — non-destructive `mergeGroceryList`

**Files:**
- Modify: `packages/convex/convex/groceryList.ts` (rename `replaceGroceryList` → `mergeGroceryList`, add merge logic)
- Modify: `packages/convex/convex/recipes.ts` (call `mergeGroceryList`)
- Test: `packages/convex/convex/groceryList.test.ts` (add cases)

**Interfaces:**
- Produces: `internal.groceryList.mergeGroceryList({ userId, lines })` — upserts by `item|unit|aisle`, preserves `checked` on surviving lines, inserts new (`checked:false`), deletes gone. Consumed by `generateGroceryList` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `packages/convex/convex/groceryList.test.ts` (it already imports `convexTest`, `api`, `schema`, `modules`, `USER_ID`, `identity`; add `internal` to the imports: `import { api } from "./_generated/api";` → also `import { internal } from "./_generated/api";`):

```ts
describe("mergeGroceryList", () => {
  it("preserves checked state for surviving lines, inserts new, deletes gone", async () => {
    const t = convexTest(schema, modules);
    // Seed: two lines, one already checked.
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: USER_ID, item: "Milk", unit: "cup", quantity: 1, aisle: "dairy", checked: true,
      });
      await ctx.db.insert("groceryList", {
        userId: USER_ID, item: "Eggs", unit: "count", quantity: 6, aisle: "other", checked: false,
      });
    });
    // Regenerate: Milk stays (new qty), Eggs gone, Bread new.
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Milk", unit: "cup", quantity: 2, aisle: "dairy" },
        { item: "Bread", unit: "loaf", quantity: 1, aisle: "bakery" },
      ],
    });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(Object.keys(byItem).sort()).toEqual(["Bread", "Milk"]);
    expect(byItem.Milk).toMatchObject({ quantity: 2, checked: true }); // preserved
    expect(byItem.Bread).toMatchObject({ checked: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pantry/convex test groceryList`
Expected: FAIL — `internal.groceryList.mergeGroceryList` is undefined.

- [ ] **Step 3: Replace `replaceGroceryList` with `mergeGroceryList`**

In `packages/convex/convex/groceryList.ts`, replace the `replaceGroceryList` export:

```ts
export const mergeGroceryList = internalMutation({
  args: {
    userId: v.string(),
    lines: v.array(groceryLineValidator),
  },
  handler: async (ctx, { userId, lines }) => {
    const existing = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const keyOf = (l: { item: string; unit: string; aisle: string }) =>
      `${l.item} ${l.unit} ${l.aisle}`;
    const byKey = new Map(existing.map((row) => [keyOf(row), row]));
    const seen = new Set<string>();

    for (const line of lines) {
      const k = keyOf(line);
      const row = byKey.get(k);
      if (row && !seen.has(k)) {
        await ctx.db.patch(row._id, { quantity: line.quantity }); // keep checked
        seen.add(k);
      } else {
        await ctx.db.insert("groceryList", {
          userId,
          item: line.item,
          unit: line.unit,
          quantity: line.quantity,
          aisle: line.aisle,
          checked: false,
        });
        seen.add(k);
      }
    }
    for (const row of existing) {
      if (!seen.has(keyOf(row))) await ctx.db.delete(row._id);
    }
  },
});
```

- [ ] **Step 4: Update the caller in `recipes.ts`**

In `generateGroceryList`, change `internal.groceryList.replaceGroceryList` to
`internal.groceryList.mergeGroceryList` (the args are identical). Regenerate:
`pnpm --filter @pantry/convex run codegen`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @pantry/convex test groceryList`
Expected: PASS — new merge test plus existing groceryList tests.

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/groceryList.ts packages/convex/convex/recipes.ts packages/convex/convex/groceryList.test.ts packages/convex/convex/_generated
git commit -m "feat(convex): non-destructive grocery-list merge preserves check-off"
```

---

### Task 6: Convex — week filter + `generateGroceryList(weekStart)`

**Files:**
- Create: `packages/convex/convex/weekFilter.ts` (pure helper)
- Test: `packages/convex/convex/weekFilter.test.ts`
- Modify: `packages/convex/convex/recipes.ts` (`generateGroceryList`)

**Interfaces:**
- Produces: `planItemsForWeek(entries, weekStart)` → `{ recipeId, multiplier }[]` keeping only `type !== "leftover"` entries whose `plannedDate` is in `[weekStart, weekStart+6]`. Consumed by `generateGroceryList`.

- [ ] **Step 1: Write the failing test**

Create `packages/convex/convex/weekFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planItemsForWeek } from "./weekFilter";

const base = (o: Partial<Record<string, unknown>>) => ({
  recipeId: "r",
  title: "x",
  servingsMultiplier: 1,
  type: "meal" as const,
  ...o,
});

describe("planItemsForWeek", () => {
  it("keeps meals within the Sun–Sat week, dropping leftovers/unscheduled/other weeks", () => {
    const items = planItemsForWeek(
      [
        base({ recipeId: "in", plannedDate: "2026-07-14", servingsMultiplier: 2 }),
        base({ recipeId: "sun", plannedDate: "2026-07-12" }), // week start
        base({ recipeId: "sat", plannedDate: "2026-07-18" }), // week end
        base({ recipeId: "next", plannedDate: "2026-07-19" }), // next week
        base({ recipeId: "leftover", plannedDate: "2026-07-14", type: "leftover" }),
        base({ recipeId: "unscheduled" }), // no plannedDate
      ],
      "2026-07-12",
    );
    expect(items).toEqual([
      { recipeId: "in", multiplier: 2 },
      { recipeId: "sun", multiplier: 1 },
      { recipeId: "sat", multiplier: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pantry/convex test weekFilter`
Expected: FAIL — cannot resolve `./weekFilter`.

- [ ] **Step 3: Implement the helper**

Create `packages/convex/convex/weekFilter.ts`:

```ts
type BasketEntry = {
  recipeId: string;
  plannedDate?: string;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

// Adds `days` to a "YYYY-MM-DD" date without Date math surprises around DST.
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function planItemsForWeek(
  entries: BasketEntry[],
  weekStart: string,
): Array<{ recipeId: string; multiplier: number }> {
  const weekEnd = addDays(weekStart, 6);
  return entries
    .filter(
      (e) =>
        e.type !== "leftover" &&
        e.plannedDate !== undefined &&
        e.plannedDate >= weekStart &&
        e.plannedDate <= weekEnd,
    )
    .map((e) => ({ recipeId: e.recipeId, multiplier: e.servingsMultiplier ?? 1 }));
}
```

- [ ] **Step 4: Wire it into `generateGroceryList`**

In `packages/convex/convex/recipes.ts`, update the action to take `weekStart` and send items:

```ts
export const generateGroceryList = action({
  args: { weekStart: v.string() },
  handler: async (ctx, { weekStart }): Promise<{ count: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const basket = await ctx.runQuery(api.basket.list, {});
    const { planItemsForWeek } = await import("./weekFilter");
    const items = planItemsForWeek(basket, weekStart);

    const lines = await recipeServiceFetch<GroceryLine[]>(userId, "POST", "/grocery-list", {
      items,
    });

    await ctx.runMutation(internal.groceryList.mergeGroceryList, { userId, lines });
    return { count: lines.length };
  },
});
```

> If a top-level `import { planItemsForWeek } from "./weekFilter";` is cleaner than the dynamic import, use that — the dynamic import only avoids any Convex bundler edge case with non-function modules; prefer the static import if codegen/typecheck stays green.

- [ ] **Step 5: Run tests + codegen**

Run: `pnpm --filter @pantry/convex run codegen && pnpm --filter @pantry/convex test`
Expected: codegen 0; all Convex tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/weekFilter.ts packages/convex/convex/weekFilter.test.ts packages/convex/convex/recipes.ts packages/convex/convex/_generated
git commit -m "feat(convex): generateGroceryList sends the week's meals with multipliers"
```

---

### Task 7: Web — `weekDates` pure helpers

**Files:**
- Create: `apps/web/src/components/planner/weekDates.ts`
- Test: `apps/web/src/components/planner/weekDates.test.ts`

**Interfaces:**
- Produces: `sundayOf(iso: string): string` (the Sunday of that date's week), `weekDays(sunday: string): string[]` (7 ISO dates Sun→Sat), `formatWeekLabel(sunday: string): string` (e.g. "Jul 12 – 18"), `addDays(iso, n): string`, `weekdayLabel(iso): string` (e.g. "Sun"). Consumed by `Planner` (Task 9).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/planner/weekDates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, formatWeekLabel, sundayOf, weekDays, weekdayLabel } from "./weekDates";

describe("weekDates", () => {
  it("sundayOf returns the Sunday of the week (Sun-start)", () => {
    expect(sundayOf("2026-07-15")).toBe("2026-07-12"); // Wed -> prior Sun
    expect(sundayOf("2026-07-12")).toBe("2026-07-12"); // Sun -> itself
    expect(sundayOf("2026-07-18")).toBe("2026-07-12"); // Sat -> prior Sun
  });

  it("weekDays lists 7 ISO dates Sun..Sat", () => {
    expect(weekDays("2026-07-12")).toEqual([
      "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15",
      "2026-07-16", "2026-07-17", "2026-07-18",
    ]);
  });

  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("formats a readable week label and weekday", () => {
    expect(formatWeekLabel("2026-07-12")).toBe("Jul 12 – 18");
    expect(weekdayLabel("2026-07-12")).toBe("Sun");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pantry/web run test src/components/planner/weekDates.test.ts`
Expected: FAIL — cannot resolve `./weekDates`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/planner/weekDates.ts`:

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function sundayOf(iso: string): string {
  const [y, m, d] = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDays(iso, -dow);
}

export function weekDays(sunday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

export function weekdayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatWeekLabel(sunday: string): string {
  const end = addDays(sunday, 6);
  const [, sm, sd] = parts(sunday);
  const [, em, ed] = parts(end);
  const left = `${MONTHS[sm - 1]} ${sd}`;
  const right = sm === em ? `${ed}` : `${MONTHS[em - 1]} ${ed}`;
  return `${left} – ${right}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pantry/web run test src/components/planner/weekDates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/planner/weekDates.ts apps/web/src/components/planner/weekDates.test.ts
git commit -m "feat(web): planner week-date helpers (Sun-start)"
```

---

### Task 8: Web — `MealCard`

**Files:**
- Create: `apps/web/src/components/planner/MealCard.tsx`
- Test: `apps/web/src/components/planner/MealCard.test.tsx`

**Interfaces:**
- Consumes: `Button` from `../ui/Button`.
- Produces: `type PlanEntry = { _id: string; recipeId: string; title: string; plannedDate?: string; servingsMultiplier?: number; type?: "meal" | "leftover" }` and
  `MealCard({ entry, onServings, onToggleLeftover, onRemove }: { entry: PlanEntry; onServings: (id: string, mult: number) => void; onToggleLeftover: (id: string, type: "meal" | "leftover") => void; onRemove: (id: string) => void })`. Renders title, a `×N` servings stepper (− calls `onServings(id, mult-0.5)` floored at 0.25, + calls `mult+0.5`), a leftover toggle, and remove. Consumed by `Planner` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/planner/MealCard.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MealCard } from "./MealCard";

const entry = {
  _id: "e1",
  recipeId: "r1",
  title: "Tacos",
  plannedDate: "2026-07-14",
  servingsMultiplier: 1,
  type: "meal" as const,
};

describe("MealCard", () => {
  it("increments servings via the + control", () => {
    const onServings = vi.fn();
    render(
      <MealCard entry={entry} onServings={onServings} onToggleLeftover={vi.fn()} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increase servings/i }));
    expect(onServings).toHaveBeenCalledWith("e1", 1.5);
  });

  it("does not go below 0.25 servings", () => {
    const onServings = vi.fn();
    render(
      <MealCard
        entry={{ ...entry, servingsMultiplier: 0.25 }}
        onServings={onServings}
        onToggleLeftover={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decrease servings/i }));
    expect(onServings).toHaveBeenCalledWith("e1", 0.25);
  });

  it("toggles to leftover", () => {
    const onToggleLeftover = vi.fn();
    render(
      <MealCard entry={entry} onServings={vi.fn()} onToggleLeftover={onToggleLeftover} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mark leftover/i }));
    expect(onToggleLeftover).toHaveBeenCalledWith("e1", "leftover");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pantry/web run test src/components/planner/MealCard.test.tsx`
Expected: FAIL — cannot resolve `./MealCard`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/planner/MealCard.tsx`:

```tsx
import { Button } from "../ui/Button";

export type PlanEntry = {
  _id: string;
  recipeId: string;
  title: string;
  plannedDate?: string;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

export function MealCard({
  entry,
  onServings,
  onToggleLeftover,
  onRemove,
}: {
  entry: PlanEntry;
  onServings: (id: string, mult: number) => void;
  onToggleLeftover: (id: string, type: "meal" | "leftover") => void;
  onRemove: (id: string) => void;
}) {
  const mult = entry.servingsMultiplier ?? 1;
  const isLeftover = entry.type === "leftover";
  return (
    <div
      className={`rounded-lg border border-border p-2 text-sm ${
        isLeftover ? "bg-border/20 text-muted" : "bg-surface text-text"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{entry.title}</span>
        <Button variant="ghost" size="sm" aria-label={`Remove ${entry.title}`} onClick={() => onRemove(entry._id)}>
          ✕
        </Button>
      </div>
      {isLeftover ? (
        <p className="mt-1 text-xs">leftovers — not on list</p>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <Button variant="ghost" size="sm" aria-label="Decrease servings" onClick={() => onServings(entry._id, Math.max(0.25, mult - 0.5))}>
            −
          </Button>
          <span className="tabular-nums">×{mult}</span>
          <Button variant="ghost" size="sm" aria-label="Increase servings" onClick={() => onServings(entry._id, mult + 0.5)}>
            +
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1"
        aria-label={isLeftover ? `Mark ${entry.title} as meal` : `Mark ${entry.title} as leftover`}
        onClick={() => onToggleLeftover(entry._id, isLeftover ? "meal" : "leftover")}
      >
        {isLeftover ? "↩ meal" : "♻ leftover"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pantry/web run test src/components/planner/MealCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/planner/MealCard.tsx apps/web/src/components/planner/MealCard.test.tsx
git commit -m "feat(web): MealCard with servings stepper + leftover toggle"
```

---

### Task 9: Web — `Planner` assembly, `/plan` wiring, remove `Basket`

**Files:**
- Create: `apps/web/src/components/planner/Planner.tsx`
- Test: `apps/web/src/components/planner/Planner.test.tsx`
- Modify: `apps/web/src/routes/plan.tsx` (render `<Planner/>`)
- Delete: `apps/web/src/components/Basket.tsx`, `apps/web/src/components/Basket.test.tsx`
- Modify: `apps/web/src/lib/optimistic.ts` if it references removed shapes (see Step 5)

**Interfaces:**
- Consumes: `api.basket.list/assignDay/setServings/setType/removeEntry`, `api.recipes.generateGroceryList` (Convex); `MealCard`, `PlanEntry`, `weekDays/sundayOf/formatWeekLabel/weekdayLabel/addDays`; `useAsyncAction`; `useNavigate` from `@tanstack/react-router`.
- Produces: `Planner()` — a week switcher, a day grid (`md+`) / agenda (`<md`) bucketing entries by `plannedDate`, an unscheduled tray, and a "Generate grocery list" button that calls `generateGroceryList({ weekStart })` then navigates to `/list`.

- [ ] **Step 1: Write the failing test**

The Planner reads `useQuery(api.basket.list)` and calls mutations; mock `convex/react` like the existing `GroceryList.test.tsx`. Fix "today" by mocking `weekDates.sundayOf`/`weekDays` is unnecessary — instead the Planner accepts an optional `initialToday?: string` prop (default computed) so tests pin the week deterministically.

Create `apps/web/src/components/planner/Planner.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { entries: [] as Array<Record<string, unknown>> } }));

vi.mock("convex/react", () => ({
  useQuery: () => state.entries,
  useMutation: () => {
    const fn = ((..._a: unknown[]) => Promise.resolve()) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
  useAction: () => () => Promise.resolve({ count: 0 }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { Planner } from "./Planner";

beforeEach(() => {
  state.entries = [];
});
afterEach(() => vi.restoreAllMocks());

describe("Planner", () => {
  it("buckets a meal under its planned day within the visible week", () => {
    state.entries = [
      { _id: "e1", recipeId: "r1", title: "Tacos", plannedDate: "2026-07-14", servingsMultiplier: 1, type: "meal" },
    ];
    render(<Planner initialToday="2026-07-15" />); // week of Jul 12–18
    const tuesday = screen.getByTestId("day-2026-07-14");
    expect(within(tuesday).getByText("Tacos")).toBeTruthy();
  });

  it("shows unscheduled entries in the tray", () => {
    state.entries = [
      { _id: "e2", recipeId: "r2", title: "Soup", servingsMultiplier: 1, type: "meal" },
    ];
    render(<Planner initialToday="2026-07-15" />);
    const tray = screen.getByTestId("unscheduled-tray");
    expect(within(tray).getByText("Soup")).toBeTruthy();
  });

  it("renders the week label", () => {
    render(<Planner initialToday="2026-07-15" />);
    expect(screen.getByText(/Jul 12 – 18/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pantry/web run test src/components/planner/Planner.test.tsx`
Expected: FAIL — cannot resolve `./Planner`.

- [ ] **Step 3: Implement `Planner`**

Create `apps/web/src/components/planner/Planner.tsx`:

```tsx
import { api } from "@pantry/convex/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { ErrorText } from "../ErrorText";
import { Button } from "../ui/Button";
import { MealCard, type PlanEntry } from "./MealCard";
import { addDays, formatWeekLabel, sundayOf, weekDays, weekdayLabel } from "./weekDates";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Planner({ initialToday }: { initialToday?: string }) {
  const [weekStart, setWeekStart] = useState(() => sundayOf(initialToday ?? todayIso()));
  const entries = (useQuery(api.basket.list) ?? []) as PlanEntry[];
  const assignDay = useMutation(api.basket.assignDay);
  const setServings = useMutation(api.basket.setServings);
  const setType = useMutation(api.basket.setType);
  const removeEntry = useMutation(api.basket.removeEntry);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const navigate = useNavigate();

  const days = weekDays(weekStart);
  const unscheduled = entries.filter((e) => !e.plannedDate);
  const byDay = (iso: string) => entries.filter((e) => e.plannedDate === iso);

  const cardHandlers = {
    onServings: (id: string, mult: number) => setServings({ id, servingsMultiplier: mult }),
    onToggleLeftover: (id: string, type: "meal" | "leftover") => setType({ id, type }),
    onRemove: (id: string) => removeEntry({ id }),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold text-text">Plan</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            ‹
          </Button>
          <span className="min-w-32 text-center text-sm text-muted">{formatWeekLabel(weekStart)}</span>
          <Button variant="ghost" size="sm" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            ›
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(sundayOf(todayIso()))}>
            This week
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {days.map((iso) => (
          <div key={iso} data-testid={`day-${iso}`} className="flex min-h-24 flex-col gap-2 rounded-xl border border-border bg-surface p-2">
            <div className="text-xs font-medium text-muted">
              {weekdayLabel(iso)} {Number(iso.slice(8, 10))}
            </div>
            {byDay(iso).map((e) => (
              <MealCard key={e._id} entry={e} {...cardHandlers} />
            ))}
            {byDay(iso).length === 0 && <span className="text-xs text-muted">—</span>}
          </div>
        ))}
      </div>

      <div data-testid="unscheduled-tray" className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-sm font-semibold text-text">Unscheduled</h3>
        {unscheduled.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. Add recipes from the Recipes tab.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((e) => (
              <div key={e._id} className="flex flex-col gap-1">
                <MealCard entry={e} {...cardHandlers} />
                <div className="flex flex-wrap gap-1">
                  {days.map((iso) => (
                    <Button
                      key={iso}
                      variant="secondary"
                      size="sm"
                      aria-label={`Move ${e.title} to ${weekdayLabel(iso)}`}
                      onClick={() => assignDay({ id: e._id, plannedDate: iso })}
                    >
                      {weekdayLabel(iso)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={gen.pending}
          onClick={async () => {
            const res = await gen.run(() => generate({ weekStart }));
            if (res) navigate({ to: "/list" });
          }}
        >
          {gen.pending ? "Generating…" : "Generate grocery list"}
        </Button>
        <ErrorText message={gen.error} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Point the route at the planner and delete `Basket`**

Replace `apps/web/src/routes/plan.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Planner } from "../components/planner/Planner";

export const Route = createFileRoute("/plan")({ component: Planner });
```

Delete `apps/web/src/components/Basket.tsx` and `apps/web/src/components/Basket.test.tsx`:

```bash
git rm apps/web/src/components/Basket.tsx apps/web/src/components/Basket.test.tsx
```

- [ ] **Step 5: Reconcile `optimistic.ts` / `RecipeList`**

`removeFromBasketOptimistic` (used by `RecipeList` via `api.basket.remove`) filters the basket query by `recipeId`. With multiple entries per recipe this still removes all matching rows in the optimistic view — no change needed. Verify by reading `apps/web/src/lib/optimistic.ts`: if it or `optimistic.test.ts` asserts a single-row shape or an `add` dedupe, update it to the plan-entry shape (rows keyed by `_id`, filtered by `recipeId`). Run `pnpm --filter @pantry/web run test src/lib/optimistic.test.ts` and fix any breakage.

- [ ] **Step 6: Run planner tests + full web suite**

Run: `pnpm --filter @pantry/web run test src/components/planner/Planner.test.tsx`
Expected: PASS (3 tests).

Run: `pnpm --filter @pantry/web test`
Expected: PASS — full suite green (Basket tests removed; RecipeList/optimistic reconciled).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/planner/Planner.tsx apps/web/src/components/planner/Planner.test.tsx apps/web/src/routes/plan.tsx apps/web/src/lib
git commit -m "feat(web): weekly meal planner on /plan (grid + agenda), retire Basket"
```

---

### Task 10: Full verification + redeploy

**Files:** none (verification only).

- [ ] **Step 1: Backend + frontend unit suites**

```bash
cd apps/recipe-service && go test ./... && cd -
pnpm --filter @pantry/convex test
pnpm --filter @pantry/web test
```
Expected: all green.

- [ ] **Step 2: Typecheck / build (needs the running Convex backend at :3210)**

```bash
pnpm --filter @pantry/types build
pnpm --filter @pantry/convex run codegen
pnpm --filter @pantry/web build
```
Expected: 0 exit; per-route code-split chunks including `plan`.

- [ ] **Step 3: Lint**

Run: `pnpm biome check apps/web/src/components/planner packages/convex/convex apps/recipe-service 2>/dev/null || npx @biomejs/biome check apps/web/src/components/planner`
Expected: clean (apply `--write` for formatter-only nits, then re-commit).

- [ ] **Step 4: Drive the app (verify skill)**

Deploy Convex functions to the running backend (`pnpm --filter @pantry/convex run deploy` — `convex dev --once`) and redeploy recipe-service (rebuild its container / restart with the new aggregation), then use the `verify` skill: sign in, add recipes, open `/plan`, assign a recipe to two days, bump servings, mark one leftover, Generate → confirm the list scales and excludes the leftover, check an item off, regenerate → confirm the check survives (merge). If the backend/recipe-service can't be redeployed in this environment, record that live e2e is unverified and rely on the unit suites.

- [ ] **Step 5: Final commit (if fixes were needed)**

```bash
git add -A && git commit -m "test(meal-planner): end-to-end verification"
```

---

## Self-Review

**Spec coverage** (`2026-07-13-meal-planner-design.md`): basket→plan-entries (Task 4); servings scaling contract (Tasks 1–3, 6); non-destructive regeneration (Task 5); week filter + generate (Task 6); dinner-first week UI grid/agenda + unscheduled tray + generate CTA (Tasks 7–9); leftovers excluded (Tasks 6 filter + 8/9 UI); Basket retired (Task 9). Dinner-only slots = no slot field this slice (schema note). Sunday–Saturday encoded in `sundayOf`/`weekDays` + `planItemsForWeek`.

**Placeholder scan:** none — every code step is complete; commands show expected output. Two "prefer whichever keeps typecheck green" notes (Convex helper typing, static vs dynamic import) are explicit fallbacks, not gaps.

**Type/name consistency:** `AggregateScaled`/`ScaledRecipe` (Tasks 2→3); `{ items:[{recipeId,multiplier}] }` (Tasks 1→3→6); `mergeGroceryList` (Tasks 5→6); `planItemsForWeek` (Task 6); `PlanEntry`, `MealCard` prop names `onServings/onToggleLeftover/onRemove` (Tasks 8→9); `sundayOf/weekDays/addDays/formatWeekLabel/weekdayLabel` (Tasks 7→9); `generateGroceryList({ weekStart })` (Tasks 6→9).

**Risks flagged in spec** carried into tasks: `add` de-dupe removal (Task 4 test asserts two rows), merge key collision safety (Task 5), atomic contract change (Tasks 1–3 + type guards), servings⇄leftovers independence (Task 6 filter drops leftovers, Task 8 hides stepper).
