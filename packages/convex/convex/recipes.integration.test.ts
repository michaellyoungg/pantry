import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Cross-service contract test: the Convex actions in recipes.ts make REAL HTTP
// calls to a running recipe-service (started by test/integration-setup.ts) — no
// fetch mock. This is the seam the unit tests can't cover: request paths,
// headers (X-Service-Secret / X-User-Id), and the JSON shapes both sides agree
// on. If either side's contract drifts, these fail.
//
// Run via `pnpm --filter @pantry/convex test:integration` (or top-level
// `pnpm test:integration`), NOT the default `pnpm test`.

const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the identity subject up to the "|" divider (see
// groceryList.test.ts), so this resolves to the user id "integration-user".
const identity = { subject: "integration-user|session" };

function client() {
  return convexTest(schema, modules).withIdentity(identity);
}

describe("recipes <-> recipe-service contract", () => {
  // Track ids we create so each test cleans up after itself — the Postgres
  // store persists across runs, so assertions must not assume an empty store.
  let created: string[] = [];

  beforeEach(() => {
    created = [];
  });

  afterEach(async () => {
    const t = client();
    for (const id of created) {
      try {
        await t.action(api.recipes.remove, { id });
      } catch {
        // already gone / test asserted the delete — ignore
      }
    }
  });

  it("create returns a persisted recipe and list includes it", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Toast",
      ingredients: [
        { quantity: 2, unit: "slices", item: "bread" },
        { quantity: 1, unit: "tbsp", item: "butter", note: "softened" },
      ],
    });
    created.push(recipe.id);

    expect(recipe.id).toBeTruthy();
    expect(recipe.title).toBe("Integration Toast");
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[1]).toMatchObject({ item: "butter", note: "softened" });

    const list = await t.action(api.recipes.list, {});
    expect(list.some((r) => r.id === recipe.id)).toBe(true);
  });

  it("update replaces title and ingredients", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Before",
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
    });
    created.push(recipe.id);

    const updated = await t.action(api.recipes.update, {
      id: recipe.id,
      title: "After",
      ingredients: [{ quantity: 2, unit: "cups", item: "sugar" }],
    });

    expect(updated.id).toBe(recipe.id);
    expect(updated.title).toBe("After");
    expect(updated.ingredients).toEqual([{ quantity: 2, unit: "cups", item: "sugar" }]);
  });

  it("remove deletes the recipe so it no longer lists", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Ephemeral",
      ingredients: [],
    });

    await t.action(api.recipes.remove, { id: recipe.id });

    const list = await t.action(api.recipes.list, {});
    expect(list.some((r) => r.id === recipe.id)).toBe(false);
  });

  it("a recipe created by one user is not visible to another (user scoping)", async () => {
    const owner = client();
    const recipe = await owner.action(api.recipes.create, { title: "Private", ingredients: [] });
    created.push(recipe.id);

    const other = convexTest(schema, modules).withIdentity({ subject: "someone-else|session" });
    const otherList = await other.action(api.recipes.list, {});
    expect(otherList.some((r) => r.id === recipe.id)).toBe(false);
  });

  it("listCatalog returns the shared catalog scope (owned by no end user)", async () => {
    const t = client();
    // The catalog is server-curated; we only assert the contract returns an
    // array without error (auth boundary satisfied, JSON shape parses).
    const catalog = await t.action(api.recipes.listCatalog, {});
    expect(Array.isArray(catalog)).toBe(true);
  });

  it("generateGroceryList aggregates basketed recipes via recipe-service", async () => {
    const t = client();
    const a = await t.action(api.recipes.create, {
      title: "Pancakes",
      ingredients: [{ quantity: 200, unit: "g", item: "flour" }],
    });
    const b = await t.action(api.recipes.create, {
      title: "Cake",
      ingredients: [{ quantity: 300, unit: "g", item: "flour" }],
    });
    created.push(a.id, b.id);

    await t.mutation(api.basket.add, { recipeId: a.id, title: a.title });
    await t.mutation(api.basket.add, { recipeId: b.id, title: b.title });

    const result = await t.action(api.recipes.generateGroceryList, {});
    expect(result.count).toBeGreaterThan(0);

    const rows = await t.query(api.groceryList.getGroceryList, {});
    // recipe-service canonicalizes the item name and picks a friendly unit, so
    // match case-insensitively. The invariant that matters: the flour from both
    // recipes aggregates into a SINGLE line (not two), with a positive quantity.
    const flourLines = rows.filter((r) => r.item.toLowerCase() === "flour");
    expect(flourLines).toHaveLength(1);
    expect(flourLines[0].quantity).toBeGreaterThan(0);
  });
});
