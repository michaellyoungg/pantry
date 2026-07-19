# Pantry Thin Loop (increment 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checking an item off the grocery list records that you own it, and the next list generation marks items you already have.

**Architecture:** The Go recipe-service already computes a canonical ingredient key and discards it; we surface it on `GroceryLine` and carry it into Convex. A new `pantryItems` table is keyed on that canonical key. `toggleItem` upserts/removes a pantry row in the same transaction as the checkbox write. `mergeGroceryList` diffs against pantry rows in state `have` and stamps `alreadyHave` on lines — annotating only, never filtering or reordering.

**Tech Stack:** Go 1.x (recipe-service), Convex (self-hosted) + convex-test/vitest, React + TanStack Router + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-18-pantry-thin-loop-design.md`

## Global Constraints

- **Coarse state only.** Pantry rows store `state: "have" | "low" | "out"`. Never a numeric quantity or unit.
- **Only `have` suppresses re-buying.** `low` and `out` are inert for don't-rebuy.
- **`source: "auto" | "manual"`.** A checkbox may only delete rows with `source === "auto"`. Manual rows are never destroyed by un-checking.
- **`mergeGroceryList.keyOf` stays `` `${item} ${unit} ${aisle}` ``.** Do not re-key on canonical in this increment.
- **Never reorder or omit grocery lines.** `GroceryList.tsx` groups *consecutive* same-aisle runs; reordering shatters aisle headers.
- **Schema additions to `groceryList` are `v.optional(...)`.** No backfill, no migration.
- **userId scoping convention:** `getAuthUserId(ctx)`, throw `"Not authenticated"` on null, query via a `by_user` index, and re-check `row.userId !== userId` on single-row lookups (throw `"Not found"`).
- **E2E navigation uses the `navigateTo()` helper**, never `page.goto()` — `goto` cancels in-flight Convex mutations.
- Commit after every task. Conventional-commit prefixes (`feat:`, `test:`, `chore:`).

---

### Task 1: Surface the canonical key from Go

The canonical ingredient key is already the accumulator map key in `AggregateScaled` (`k.item`). It is computed and thrown away. This task emits it.

**Heads-up:** `aggregate_test.go` compares with `reflect.DeepEqual` against 8 full `GroceryLine{...}` literals. Adding a struct field breaks *all* of them; every `want` needs `CanonicalItem` filled in. This is expected, not a regression.

**Files:**
- Modify: `apps/recipe-service/internal/recipe/types.go` (`GroceryLine` struct)
- Modify: `apps/recipe-service/internal/recipe/aggregate.go` (emit loop, ~line 89)
- Test: `apps/recipe-service/internal/recipe/aggregate_test.go`

**Interfaces:**
- Produces: `GroceryLine.CanonicalItem string \`json:"canonicalItem"\`` — the lowercased, synonym-resolved item key (e.g. `"green onion"`). Every line always has it; unknown items pass through as their own lowercased key.

- [ ] **Step 1: Write the failing test**

Add to `apps/recipe-service/internal/recipe/aggregate_test.go`:

```go
func TestAggregate_EmitsCanonicalItem(t *testing.T) {
	got := Aggregate([]Recipe{
		// "scallions" is a real synonym in normalization.json resolving to the
		// canonical "green onion". (Note: there is no pluralization logic —
		// "green onions" would NOT resolve. Only listed synonyms do.)
		r("a", Ingredient{Quantity: 2, Unit: "bunch", Item: "scallions"}),
	})
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1", len(got))
	}
	if got[0].CanonicalItem != "green onion" {
		t.Fatalf("CanonicalItem = %q, want %q", got[0].CanonicalItem, "green onion")
	}
	if got[0].Item != "Green onion" {
		t.Fatalf("Item = %q, want display %q", got[0].Item, "Green onion")
	}
}

func TestAggregate_UnknownItemCanonicalPassesThrough(t *testing.T) {
	got := Aggregate([]Recipe{
		r("a", Ingredient{Quantity: 1, Unit: "", Item: "Dragonfruit"}),
	})
	if len(got) != 1 {
		t.Fatalf("got %d lines, want 1", len(got))
	}
	if got[0].CanonicalItem != "dragonfruit" {
		t.Fatalf("CanonicalItem = %q, want %q", got[0].CanonicalItem, "dragonfruit")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestAggregate_EmitsCanonicalItem -v`
Expected: FAIL — compile error, `got[0].CanonicalItem undefined (type GroceryLine has no field or method CanonicalItem)`

- [ ] **Step 3: Add the struct field**

In `apps/recipe-service/internal/recipe/types.go`, replace the `GroceryLine` struct:

```go
type GroceryLine struct {
	Item string `json:"item"`
	// CanonicalItem is the normalized ingredient key (lowercased, synonyms
	// resolved) that Item's display string was derived from. It is the identity
	// the pantry is keyed on — Item is for humans, CanonicalItem is for joins.
	CanonicalItem string  `json:"canonicalItem"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"`
	Aisle         string  `json:"aisle"`
}
```

- [ ] **Step 4: Emit it from the aggregation loop**

In `apps/recipe-service/internal/recipe/aggregate.go`, in `AggregateScaled`, the emit loop iterates `for _, k := range order` where `k.item` is the canonical key. Replace the `lines = append(...)` line:

```go
		lines = append(lines, GroceryLine{
			Item:          a.display,
			CanonicalItem: k.item,
			Unit:          unit,
			Quantity:      qty,
			Aisle:         a.aisle,
		})
```

No change to the `acc` struct is needed — the canonical key is already the map key.

- [ ] **Step 5: Run the new tests**

Run: `cd apps/recipe-service && go test ./internal/recipe/ -run TestAggregate_EmitsCanonicalItem -v`
Expected: PASS

- [ ] **Step 6: Fix the 8 pre-existing DeepEqual assertions**

Run: `cd apps/recipe-service && go test ./... 2>&1 | head -40`
Expected: failures in `aggregate_test.go` (and possibly `handler_test.go`) where `want` literals now lack `CanonicalItem`.

For each failing `want := []GroceryLine{...}` literal, add `CanonicalItem` with the canonical form of the item — the lowercased key, not the display string. Examples:

```go
	// was: {Item: "Garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}
	{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}
	// was: {Item: "Butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy"}
	{Item: "Butter", CanonicalItem: "butter", Unit: "cup", Quantity: 0.75, Aisle: "dairy"}
```

- [ ] **Step 7: Run the full Go suite**

Run: `cd apps/recipe-service && go test ./...`
Expected: PASS, all packages (`ok` lines only)

- [ ] **Step 8: Commit**

```bash
git add apps/recipe-service/internal/recipe/types.go apps/recipe-service/internal/recipe/aggregate.go apps/recipe-service/internal/recipe/aggregate_test.go apps/recipe-service/internal/recipe/handler_test.go
git commit -m "feat(recipe-service): emit canonicalItem on grocery lines"
```

---

### Task 2: Carry `canonicalItem` through the TS contract

The compile-time guard at `groceryList.ts` (`_groceryLineInSync`) pins the Convex validator to `@pantry/types`. Changing one without the other fails the build — that is the safety net, use it.

**Files:**
- Modify: `packages/types/src/index.ts` (`GroceryLine` interface)
- Modify: `packages/convex/convex/groceryList.ts` (`groceryLineValidator`, `mergeGroceryList`)
- Modify: `packages/convex/convex/schema.ts` (`groceryList` table)
- Test: `packages/convex/convex/groceryList.test.ts`

**Interfaces:**
- Consumes: Task 1's `canonicalItem` JSON field on grocery lines from recipe-service.
- Produces: `groceryList` rows carrying `canonicalItem?: string`; `GroceryLine` TS type with required `canonicalItem: string`.

- [ ] **Step 1: Write the failing test**

Add to the `mergeGroceryList` describe block in `packages/convex/convex/groceryList.test.ts`:

```ts
  it("persists canonicalItem on inserted lines", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Green onion", canonicalItem: "green onion", unit: "bunch", quantity: 2, aisle: "produce" },
      ],
    });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalItem).toBe("green onion");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/convex && pnpm vitest run groceryList.test.ts`
Expected: FAIL — the validator rejects the extra `canonicalItem` arg (`ArgumentValidationError`).

- [ ] **Step 3: Update the shared type**

In `packages/types/src/index.ts`:

```ts
export interface GroceryLine {
  item: string;
  /** Normalized ingredient key ("green onion"); the identity the pantry joins on. */
  canonicalItem: string;
  unit: string;
  quantity: number;
  aisle: string;
}
```

- [ ] **Step 4: Update the validator and the schema**

In `packages/convex/convex/groceryList.ts`:

```ts
export const groceryLineValidator = v.object({
  item: v.string(),
  canonicalItem: v.string(),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
});
```

In `packages/convex/convex/schema.ts`, replace the `groceryList` table definition:

```ts
  // The live, reactive grocery list (aggregated lines).
  groceryList: defineTable({
    userId: v.string(),
    item: v.string(),
    // Normalized key from recipe-service; optional because rows predating
    // BL-0021 don't have it. Rows without it simply never match a pantry item.
    canonicalItem: v.optional(v.string()),
    unit: v.string(),
    quantity: v.number(),
    aisle: v.string(),
    checked: v.boolean(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 5: Persist it in the merge**

In `mergeGroceryList`, the insert branch gains the field. `keyOf` is **unchanged**:

```ts
        await ctx.db.insert("groceryList", {
          userId,
          item: line.item,
          canonicalItem: line.canonicalItem,
          unit: line.unit,
          quantity: line.quantity,
          aisle: line.aisle,
          checked: false,
        });
```

Also patch it onto surviving rows so legacy rows heal on the next generation. Replace the patch branch:

```ts
      if (row && !seen.has(k)) {
        // keep `checked`; heal canonicalItem onto pre-BL-0021 rows
        await ctx.db.patch(row._id, {
          quantity: line.quantity,
          canonicalItem: line.canonicalItem,
        });
      } else {
```

- [ ] **Step 6: Run the tests**

Run: `cd packages/convex && pnpm vitest run groceryList.test.ts`
Expected: FAIL — the pre-existing merge test's `lines` literals lack `canonicalItem`.

Fix them by adding the field to each line literal in that file, e.g.:

```ts
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
        { item: "Bread", canonicalItem: "bread", unit: "loaf", quantity: 1, aisle: "bakery" },
```

Re-run. Expected: PASS.

- [ ] **Step 7: Typecheck the monorepo**

Run: `pnpm -w typecheck`
Expected: PASS. If `_groceryLineInSync` errors, the validator and the shared type disagree — reconcile them; that guard is doing its job.

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/index.ts packages/convex/convex/groceryList.ts packages/convex/convex/schema.ts packages/convex/convex/groceryList.test.ts
git commit -m "feat(convex): carry canonicalItem onto grocery list rows"
```

---

### Task 3: `pantryItems` table + pantry queries/mutations

**Files:**
- Modify: `packages/convex/convex/schema.ts` (add `pantryItems`)
- Create: `packages/convex/convex/pantry.ts`
- Test: `packages/convex/convex/pantry.test.ts`

**Interfaces:**
- Produces:
  - `api.pantry.list` — query, no args → pantry rows for the user, aisle-grouped order (sorted by `aisle`, then `display`).
  - `api.pantry.setState` — mutation, `{ id: Id<"pantryItems">, state: "have" | "low" | "out" }`.
  - `api.pantry.remove` — mutation, `{ id: Id<"pantryItems"> }`.
  - `upsertFromCheckoff(ctx, {userId, canonicalItem, display, aisle})` — plain async helper (not a Convex function), exported for Task 4.
  - `removeAutoRow(ctx, {userId, canonicalItem})` — plain async helper, exported for Task 4.

- [ ] **Step 1: Add the table to the schema**

In `packages/convex/convex/schema.ts`, add before the closing `});`:

```ts
  // Pantry (BL-0021 increment 1). Deliberately coarse: `state`, never a
  // quantity — numeric inventory drifts from reality within days. Keyed on the
  // normalized ingredient so "Green onion" and "green onions" are one row.
  pantryItems: defineTable({
    userId: v.string(),
    canonicalItem: v.string(), // "green onion"
    display: v.string(), // "Green onion"
    aisle: v.string(),
    state: v.union(v.literal("have"), v.literal("low"), v.literal("out")),
    // "auto" rows came from checking an item off the grocery list and may be
    // removed by un-checking it. "manual" rows are user-curated and never are.
    source: v.union(v.literal("auto"), v.literal("manual")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_item", ["userId", "canonicalItem"]),
```

- [ ] **Step 2: Write the failing tests**

Create `packages/convex/convex/pantry.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

async function seed(
  t: ReturnType<typeof convexTest>,
  over: Partial<{
    userId: string;
    canonicalItem: string;
    display: string;
    aisle: string;
    state: "have" | "low" | "out";
    source: "auto" | "manual";
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("pantryItems", {
      userId: USER_ID,
      canonicalItem: "butter",
      display: "Butter",
      aisle: "dairy",
      state: "have" as const,
      source: "auto" as const,
      updatedAt: 0,
      ...over,
    }),
  );
}

describe("pantry", () => {
  it("lists only the authenticated user's rows", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await seed(t, { userId: "someone-else", canonicalItem: "milk", display: "Milk" });

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonicalItem: "butter", state: "have" });
  });

  it("sets an item's state", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.pantry.setState, { id, state: "low" });

    const rows = await asUser.query(api.pantry.list, {});
    expect(rows[0].state).toBe("low");
  });

  it("rejects setting state on another user's row (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(
      t.withIdentity(identity).mutation(api.pantry.setState, { id, state: "low" }),
    ).rejects.toThrow();
  });

  it("removes an item", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.pantry.remove, { id });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });

  it("rejects removing another user's row (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(t.withIdentity(identity).mutation(api.pantry.remove, { id })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/convex && pnpm vitest run pantry.test.ts`
Expected: FAIL — `api.pantry` is undefined / module not found.

- [ ] **Step 4: Implement `pantry.ts`**

Create `packages/convex/convex/pantry.ts`:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

export const pantryStateValidator = v.union(
  v.literal("have"),
  v.literal("low"),
  v.literal("out"),
);

// --- helpers, shared with groceryList.toggleItem (not client-callable) ---

/**
 * Record that the user owns `canonicalItem`. Idempotent: re-checking an item
 * refreshes it rather than duplicating. Never downgrades a hand-curated row to
 * `source: "auto"` — provenance, once manual, stays manual.
 */
export async function upsertFromCheckoff(
  ctx: MutationCtx,
  args: { userId: string; canonicalItem: string; display: string; aisle: string },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();

  if (existing === null) {
    await ctx.db.insert("pantryItems", {
      userId: args.userId,
      canonicalItem: args.canonicalItem,
      display: args.display,
      aisle: args.aisle,
      state: "have",
      source: "auto",
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.patch(existing._id, { state: "have", updatedAt: Date.now() });
}

/**
 * Undo an auto-add when the user un-checks a line. Rows with
 * `source: "manual"` are left alone — a checkbox must never destroy curated data.
 */
export async function removeAutoRow(
  ctx: MutationCtx,
  args: { userId: string; canonicalItem: string },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();
  if (existing === null || existing.source !== "auto") return;
  await ctx.db.delete(existing._id);
}

// --- client-facing functions ---

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("pantryItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Sorted here (not in the UI) so aisle grouping is a simple consecutive
    // scan, matching how GroceryList groups.
    return rows.sort(
      (a, b) => a.aisle.localeCompare(b.aisle) || a.display.localeCompare(b.display),
    );
  },
});

export const setState = mutation({
  args: { id: v.id("pantryItems"), state: pantryStateValidator },
  handler: async (ctx, { id, state }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { state, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("pantryItems") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/convex && pnpm vitest run pantry.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/schema.ts packages/convex/convex/pantry.ts packages/convex/convex/pantry.test.ts
git commit -m "feat(convex): pantryItems table with list/setState/remove"
```

---

### Task 4: Inflow — auto-add on check-off

**Files:**
- Modify: `packages/convex/convex/groceryList.ts` (`toggleItem`)
- Test: `packages/convex/convex/pantry.test.ts` (new describe block)

**Interfaces:**
- Consumes: `upsertFromCheckoff`, `removeAutoRow` from Task 3; `canonicalItem` on grocery rows from Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `packages/convex/convex/pantry.test.ts`:

```ts
describe("pantry inflow from check-off", () => {
  async function seedLine(
    t: ReturnType<typeof convexTest>,
    over: Partial<{ canonicalItem: string | undefined }> = {},
  ) {
    return await t.run(async (ctx) =>
      ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "Butter",
        canonicalItem: "butter",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        ...over,
      }),
    );
  }

  it("checking a line off records the item as owned", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await seedLine(t);

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });

    const rows = await asUser.query(api.pantry.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      canonicalItem: "butter",
      display: "Butter",
      aisle: "dairy",
      state: "have",
      source: "auto",
    });
  });

  it("checking the same item twice is idempotent", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await seedLine(t);

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: false });
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(1);
  });

  it("un-checking removes an auto-added row", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await seedLine(t);

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: false });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });

  it("un-checking never destroys a manually curated row", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await seed(t, { source: "manual", state: "low" });
    const id = await seedLine(t);

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: false });

    const rows = await asUser.query(api.pantry.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", state: "have" });
  });

  it("is inert for legacy lines with no canonicalItem", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await seedLine(t, { canonicalItem: undefined });

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });
});
```

Note: the fourth test asserts the manual row's state becomes `have` — the check-off upsert *promotes* an existing row's state but leaves `source` alone, and the un-check then declines to delete it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/convex && pnpm vitest run pantry.test.ts`
Expected: FAIL — the first test gets 0 pantry rows, `expect(rows).toHaveLength(1)` fails.

- [ ] **Step 3: Wire `toggleItem` to the pantry helpers**

In `packages/convex/convex/groceryList.ts`, add the import at the top:

```ts
import { removeAutoRow, upsertFromCheckoff } from "./pantry";
```

Replace `toggleItem`:

```ts
// Checking a line off is also the pantry's inflow signal (BL-0021): it records
// that the user now owns the item. Both writes happen in this one mutation, so
// they are a single transaction — a checkbox can never report success while the
// pantry write was lost.
export const toggleItem = mutation({
  args: { id: v.id("groceryList"), checked: v.boolean() },
  handler: async (ctx, { id, checked }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { checked });

    // Rows predating BL-0021 have no canonical key and can't be joined to a
    // pantry item; leave the pantry untouched for them.
    if (row.canonicalItem === undefined) return;
    if (checked) {
      await upsertFromCheckoff(ctx, {
        userId,
        canonicalItem: row.canonicalItem,
        display: row.item,
        aisle: row.aisle,
      });
    } else {
      await removeAutoRow(ctx, { userId, canonicalItem: row.canonicalItem });
    }
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/convex && pnpm vitest run`
Expected: PASS — all of `pantry.test.ts` (10 tests) and `groceryList.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/groceryList.ts packages/convex/convex/pantry.test.ts
git commit -m "feat(convex): auto-add pantry items when checking off the grocery list"
```

---

### Task 5: Don't-rebuy — annotate owned lines

**Files:**
- Modify: `packages/convex/convex/schema.ts` (`groceryList.alreadyHave`)
- Modify: `packages/convex/convex/groceryList.ts` (`mergeGroceryList`, new `needItAnyway`)
- Test: `packages/convex/convex/groceryList.test.ts`

**Interfaces:**
- Produces: `groceryList` rows carrying `alreadyHave?: boolean`; `api.groceryList.needItAnyway` — mutation, `{ id: Id<"groceryList"> }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/convex/convex/groceryList.test.ts`:

```ts
describe("don't-rebuy (BL-0021)", () => {
  async function seedPantry(
    t: ReturnType<typeof convexTest>,
    canonicalItem: string,
    state: "have" | "low" | "out",
  ) {
    await t.run(async (ctx) =>
      ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem,
        display: canonicalItem,
        aisle: "dairy",
        state,
        source: "manual" as const,
        updatedAt: 0,
      }),
    );
  }

  it("flags lines the user already has", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(byItem.Butter.alreadyHave).toBe(true);
    expect(byItem.Milk.alreadyHave).toBe(false);
  });

  it("does not flag items that are low or out", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "low");
    await seedPantry(t, "milk", "out");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.every((r) => r.alreadyHave === false)).toBe(true);
  });

  it("never drops or reorders lines", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.map((r) => r.item)).toEqual(["Butter", "Milk"]);
  });

  it("needItAnyway clears the flag without touching the pantry row", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
      ],
    });
    const asUser = t.withIdentity(identity);
    const [line] = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.needItAnyway, { id: line._id });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].alreadyHave).toBe(false);
    expect(await asUser.query(api.pantry.list, {})).toHaveLength(1);
  });

  it("preserves a needItAnyway override across regeneration", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");
    const line = { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" };
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });
    const asUser = t.withIdentity(identity);
    const [row] = await asUser.query(api.groceryList.getGroceryList, {});
    await asUser.mutation(api.groceryList.needItAnyway, { id: row._id });

    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].alreadyHave).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/convex && pnpm vitest run groceryList.test.ts`
Expected: FAIL — `alreadyHave` is `undefined`, not `true`.

- [ ] **Step 3: Add the schema field**

In `packages/convex/convex/schema.ts`, add to the `groceryList` table after `checked`:

```ts
    // Set during generation when a pantry row for this canonicalItem is in
    // state "have". Purely an annotation — the line is still shown, still in
    // its original position, still checkable. Cleared per-line by needItAnyway.
    alreadyHave: v.optional(v.boolean()),
```

- [ ] **Step 4: Compute the flag in the merge**

In `packages/convex/convex/groceryList.ts`, inside `mergeGroceryList`'s handler, add after the `existing` query:

```ts
    // "Don't rebuy": items the user already owns. Only `have` counts — `low`
    // and `out` mean they still need to buy it.
    const owned = new Set(
      (
        await ctx.db
          .query("pantryItems")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      )
        .filter((p) => p.state === "have")
        .map((p) => p.canonicalItem),
    );
```

Update the insert branch to stamp it:

```ts
        await ctx.db.insert("groceryList", {
          userId,
          item: line.item,
          canonicalItem: line.canonicalItem,
          unit: line.unit,
          quantity: line.quantity,
          aisle: line.aisle,
          checked: false,
          alreadyHave: owned.has(line.canonicalItem),
        });
```

The patch branch deliberately does **not** recompute `alreadyHave`, which is what preserves a `needItAnyway` override across regeneration — the same reasoning that preserves `checked`. Its comment should say so:

```ts
      if (row && !seen.has(k)) {
        // keep `checked` and any needItAnyway override; heal canonicalItem
        await ctx.db.patch(row._id, {
          quantity: line.quantity,
          canonicalItem: line.canonicalItem,
        });
      } else {
```

- [ ] **Step 5: Add the `needItAnyway` mutation**

Append to `packages/convex/convex/groceryList.ts`:

```ts
// "I need it anyway" — the pantry thinks the user owns this, but they don't (or
// they want more). Clears the annotation for this line only; the pantry row is
// left alone, because the user is correcting the list, not the pantry.
export const needItAnyway = mutation({
  args: { id: v.id("groceryList") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { alreadyHave: false });
  },
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/convex && pnpm vitest run`
Expected: PASS, all suites

- [ ] **Step 7: Commit**

```bash
git add packages/convex/convex/schema.ts packages/convex/convex/groceryList.ts packages/convex/convex/groceryList.test.ts
git commit -m "feat(convex): flag already-owned lines during list generation"
```

---

### Task 6: Pantry page

**Files:**
- Modify: `apps/web/src/routes/pantry.tsx` (replace the "Coming soon" stub)
- Create: `apps/web/src/components/Pantry.tsx`
- Modify: `apps/web/src/lib/optimistic.ts`
- Test: `apps/web/src/components/Pantry.test.tsx`

**Interfaces:**
- Consumes: `api.pantry.list`, `api.pantry.setState`, `api.pantry.remove` from Task 3.
- Produces: `setPantryStateOptimistic`, `removePantryItemOptimistic` in `lib/optimistic.ts`; `<Pantry />`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/Pantry.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutationMock } = vi.hoisted(() => ({
  state: { rows: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.rows,
  useMutation: () => {
    const fn = ((...args: unknown[]) =>
      (mutationMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

import { Pantry } from "./Pantry";

const rows = [
  {
    _id: "p1",
    userId: "dev-user",
    canonicalItem: "butter",
    display: "Butter",
    aisle: "dairy",
    state: "have",
    source: "auto",
    updatedAt: 0,
    _creationTime: 0,
  },
  {
    _id: "p2",
    userId: "dev-user",
    canonicalItem: "green onion",
    display: "Green onion",
    aisle: "produce",
    state: "low",
    source: "manual",
    updatedAt: 0,
    _creationTime: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = rows;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pantry", () => {
  it("groups items under aisle headings", () => {
    render(<Pantry />);
    expect(screen.getByRole("heading", { name: /dairy/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /produce/i })).toBeTruthy();
    expect(screen.getByText("Butter")).toBeTruthy();
    expect(screen.getByText("Green onion")).toBeTruthy();
  });

  it("cycles state have -> low when the state button is clicked", () => {
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /butter is: have/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1", state: "low" });
  });

  it("cycles out -> have, wrapping around", () => {
    state.rows = [{ ...rows[0], state: "out" }];
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /butter is: out/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1", state: "have" });
  });

  it("removes an item", () => {
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /remove butter/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1" });
  });

  it("explains how the pantry fills up when empty", () => {
    state.rows = [];
    render(<Pantry />);
    expect(screen.getByText(/check items off your grocery list/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/components/Pantry.test.tsx`
Expected: FAIL — cannot resolve `./Pantry`.

- [ ] **Step 3: Add the optimistic updaters**

Append to `apps/web/src/lib/optimistic.ts`:

```ts
export function setPantryStateOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"pantryItems">; state: "have" | "low" | "out" },
): void {
  const cur = localStore.getQuery(api.pantry.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.pantry.list,
    {},
    cur.map((p) => (p._id === args.id ? { ...p, state: args.state } : p)),
  );
}

export function removePantryItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"pantryItems"> },
): void {
  const cur = localStore.getQuery(api.pantry.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.pantry.list,
    {},
    cur.filter((p) => p._id !== args.id),
  );
}
```

- [ ] **Step 4: Implement the component**

Create `apps/web/src/components/Pantry.tsx`:

```tsx
import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { removePantryItemOptimistic, setPantryStateOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Cycling forward from "out" wraps to "have": restocking is the common case,
// and it keeps the whole control reachable with one repeated tap.
const NEXT_STATE = { have: "low", low: "out", out: "have" } as const;

const STATE_STYLE = {
  have: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  low: "bg-amber-500/10 text-amber-600",
  out: "bg-border text-muted",
} as const;

export function Pantry() {
  const items = useQuery(api.pantry.list) ?? [];
  const setState = useMutation(api.pantry.setState).withOptimisticUpdate(setPantryStateOptimistic);
  const remove = useMutation(api.pantry.remove).withOptimisticUpdate(removePantryItemOptimistic);
  const { run, error } = useAsyncAction();

  // Rows arrive sorted by aisle from Convex; group consecutive runs (same
  // approach as GroceryList).
  const groups: { aisle: string; items: typeof items }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === item.aisle) last.items.push(item);
    else groups.push({ aisle: item.aisle, items: [item] });
  }

  return (
    <Card title="Pantry">
      {items.length === 0 && (
        <p className="text-sm text-muted">
          Nothing here yet — check items off your grocery list and they'll show up, so you don't
          rebuy things you already own.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.aisle}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {titleCase(group.aisle)}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item._id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-text">{item.display}</span>
                  <button
                    type="button"
                    aria-label={`${item.display} is: ${item.state}. Change.`}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[item.state]}`}
                    onClick={() =>
                      run(() => setState({ id: item._id, state: NEXT_STATE[item.state] }))
                    }
                  >
                    {item.state}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.display}`}
                    onClick={() => run(() => remove({ id: item._id }))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {items.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Only items marked <strong>have</strong> are skipped when building your grocery list.
        </p>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 5: Replace the route stub**

Replace `apps/web/src/routes/pantry.tsx` entirely:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Pantry } from "../components/Pantry";

function PantryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-text">Pantry</h2>
      <Pantry />
    </div>
  );
}

export const Route = createFileRoute("/pantry")({ component: PantryPage });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/components/Pantry.test.tsx`
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Pantry.tsx apps/web/src/components/Pantry.test.tsx apps/web/src/routes/pantry.tsx apps/web/src/lib/optimistic.ts
git commit -m "feat(web): pantry page with have/low/out cycle and remove"
```

---

### Task 7: "Already have" on the grocery list

**Files:**
- Modify: `apps/web/src/components/GroceryList.tsx`
- Test: `apps/web/src/components/GroceryList.test.tsx`

**Interfaces:**
- Consumes: `alreadyHave` on grocery rows and `api.groceryList.needItAnyway` from Task 5.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("GroceryList", ...)` block in `apps/web/src/components/GroceryList.test.tsx`:

```tsx
  it("marks lines the user already owns", () => {
    state.lines = [{ ...oneLine[0], item: "butter", alreadyHave: true }];
    render(<GroceryList />);
    expect(screen.getByText(/already have/i)).toBeTruthy();
  });

  it("does not mark ordinary lines", () => {
    state.lines = [{ ...oneLine[0], alreadyHave: false }];
    render(<GroceryList />);
    expect(screen.queryByText(/already have/i)).toBeNull();
  });

  it("still renders owned lines in place, never hiding them", () => {
    state.lines = [
      { ...oneLine[0], _id: "g1", item: "butter", alreadyHave: true },
      { ...oneLine[0], _id: "g2", item: "milk", alreadyHave: false },
    ];
    render(<GroceryList />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("clears the flag via needItAnyway", () => {
    state.lines = [{ ...oneLine[0], item: "butter", alreadyHave: true }];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /need it anyway/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/components/GroceryList.test.tsx`
Expected: FAIL — "already have" text not found.

- [ ] **Step 3: Render the badge and the action**

In `apps/web/src/components/GroceryList.tsx`, add the mutation alongside the existing ones:

```ts
  const needItAnyway = useMutation(api.groceryList.needItAnyway);
```

Replace the `<li>` body (from `<label ...>` through `</label>`) with:

```tsx
                <li key={line._id}>
                  <div className="flex items-center gap-2">
                    <label
                      className={`flex flex-1 items-center gap-2 text-sm ${
                        line.checked
                          ? "text-muted line-through"
                          : line.alreadyHave
                            ? "text-muted"
                            : "text-text"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary)]"
                        checked={line.checked}
                        onChange={(e) =>
                          run(() => toggle({ id: line._id, checked: e.target.checked }))
                        }
                      />
                      <span>
                        {formatQuantity(line.quantity)} {line.unit} {line.item}
                      </span>
                    </label>
                    {line.alreadyHave && (
                      <>
                        <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                          already have
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(() => needItAnyway({ id: line._id }))}
                        >
                          Need it anyway
                        </Button>
                      </>
                    )}
                  </div>
                </li>
```

Note the line stays in position — the flag only changes styling and appends controls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/components/GroceryList.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full web suite and typecheck**

Run: `cd apps/web && pnpm vitest run && cd ../.. && pnpm -w typecheck`
Expected: PASS, coverage thresholds still met (lines 50 / functions 40 / branches 45 / statements 48)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/GroceryList.tsx apps/web/src/components/GroceryList.test.tsx
git commit -m "feat(web): show already-have on grocery lines with need-it-anyway"
```

---

### Task 8: End-to-end coverage + close out the backlog item

**Files:**
- Modify: `apps/web/e2e/core-loop.spec.ts`
- Modify: `docs/backlog/BL-0021-pantry-thin-loop.md`
- Modify: `docs/backlog/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.

- [ ] **Step 1: Confirm the helper signatures**

`apps/web/e2e/helpers.ts` exports `uniqueSuffix()`, `signUp(page)`, `navigateTo(page, label)`, `createRecipeAndAddToBasket(...)`, and `scheduleAndGenerate(...)`. Run `sed -n '1,80p' apps/web/e2e/helpers.ts` to confirm the exact parameters of the last two before wiring up the setup, and check the nav label strings in `Nav.tsx` (`NAV_ITEMS`) so `navigateTo` targets match exactly.

- [ ] **Step 2: Write the e2e test**

Append to `apps/web/e2e/core-loop.spec.ts`, adapting the setup calls to the helper names confirmed in Step 1:

```ts
test("checking an item off fills the pantry and suppresses re-buying", async ({ page }) => {
  // Assumes the surrounding spec has signed in and generated a grocery list.
  // Nav labels come from NAV_ITEMS in Nav.tsx: Home / Plan / Recipes / List / Pantry.
  await navigateTo(page, "List");
  const firstItem = page.getByRole("checkbox").first();
  const label = await firstItem.locator("xpath=ancestor::label").innerText();
  await firstItem.check();
  await expect(firstItem).toBeChecked();

  // Nav link, not page.goto() — goto cancels the in-flight check-off mutation.
  await navigateTo(page, "Pantry");
  const itemWord = label.trim().split(/\s+/).pop() ?? "";
  await expect(page.getByText(new RegExp(itemWord, "i"))).toBeVisible();
  await expect(page.getByRole("button", { name: /is: have/i }).first()).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS. If the stack isn't up, bring it up first per `scripts/e2e.sh`; recover `RECIPE_SERVICE_SECRET` from `convex env list` rather than letting the script regenerate it.

- [ ] **Step 4: Close out the backlog item**

In `docs/backlog/BL-0021-pantry-thin-loop.md` frontmatter, set `status: done` and add the spec:

```yaml
status: done
related_specs: [2026-07-12-full-app-ux-plan.md, 2026-07-18-pantry-thin-loop-design.md]
```

Add a note at the end of the body:

```markdown
## Increment status

Increment 1 (inflow from check-off + don't-rebuy) shipped 2026-07-18; see
`docs/superpowers/specs/2026-07-18-pantry-thin-loop-design.md`. Cook-decrement
and shelf-life/expiry nudges remain — the former needs a `markCooked` event on
`basket` that BL-0018 has not built. File them as new items before closing.
```

In `docs/backlog/README.md`, set the BL-0021 row's Status cell to `done`.

- [ ] **Step 5: Run everything**

Run: `pnpm -w typecheck && pnpm -w test && cd apps/recipe-service && go test ./...`
Expected: PASS across the board

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/core-loop.spec.ts docs/backlog/BL-0021-pantry-thin-loop.md docs/backlog/README.md
git commit -m "test(e2e): cover the pantry inflow loop; mark BL-0021 increment 1 done"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Data model (`pantryItems`) | Task 3 |
| §2 Plumbing `canonicalItem` (5 places) | Tasks 1 (Go ×2) + 2 (types, validator, schema) |
| §2 `keyOf` left alone | Task 2 Step 5 — asserted by the preserved merge test |
| §3 Inflow, upsert idempotency, auto-vs-manual | Task 4 |
| §3 Helper lives in `pantry.ts`, `toggleItem` stays thin | Task 3 Step 4, Task 4 Step 3 |
| §4 Don't-rebuy, `needItAnyway`, annotate-not-filter | Task 5 |
| §5 Web pantry page, components-not-routes, optimistic | Task 6 |
| §5 Grocery badge | Task 7 |
| §6 Escape hatch (manual cycle + remove) | Task 6 — `NEXT_STATE` cycle, remove button |
| Testing table | Tasks 1–8, one row each |
| Deferred work | Task 8 Step 4 records it on the backlog item |

**Type consistency:** `canonicalItem` (TS) / `CanonicalItem` (Go, `json:"canonicalItem"`) is consistent across Tasks 1, 2, 3, 4, 5. `upsertFromCheckoff` / `removeAutoRow` are defined in Task 3 and consumed under those exact names in Task 4. `api.pantry.list` / `setState` / `remove` are defined in Task 3 and consumed in Task 6. `alreadyHave` is defined in Task 5 and consumed in Task 7. `setPantryStateOptimistic` / `removePantryItemOptimistic` are defined and consumed within Task 6.

**Known ordering constraint:** Tasks must run in order. Task 2's tests fail until Task 1 ships `canonicalItem` from Go only if run against a live service — the Convex unit tests pass standalone because they feed lines directly, so the sequence is safe either way.
