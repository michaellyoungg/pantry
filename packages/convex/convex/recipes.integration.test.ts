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

// recipe-service's sentinel owner for the shared catalog. Mirrors
// internal/recipe/types.go's CatalogUserID.
const CATALOG_USER_ID = "catalog";

function client() {
  return convexTest(schema, modules).withIdentity(identity);
}

describe("recipes <-> recipe-service contract", () => {
  // Track ids we create so each test cleans up after itself — the Postgres
  // store persists across runs, so assertions must not assume an empty store.
  let created: string[] = [];
  // Recipes owned by the sentinel catalog user need deleting AS that user;
  // a normal caller's delete cannot see them.
  let catalogCreated: string[] = [];

  beforeEach(() => {
    created = [];
    catalogCreated = [];
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
    const catalogT = convexTest(schema, modules).withIdentity({
      subject: `${CATALOG_USER_ID}|session`,
    });
    for (const id of catalogCreated) {
      try {
        await catalogT.action(api.recipes.remove, { id });
      } catch {
        // ignore
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
      steps: ["Toast the bread.", "Spread the butter."],
    });
    created.push(recipe.id);

    expect(recipe.id).toBeTruthy();
    expect(recipe.title).toBe("Integration Toast");
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[1]).toMatchObject({ item: "butter", note: "softened" });
    expect(recipe.steps).toEqual(["Toast the bread.", "Spread the butter."]);

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
      steps: ["Cream the sugar."],
    });

    expect(updated.id).toBe(recipe.id);
    expect(updated.title).toBe("After");
    expect(updated.ingredients).toEqual([{ quantity: 2, unit: "cups", item: "sugar" }]);
    expect(updated.steps).toEqual(["Cream the sugar."]);
  });

  // BL-0035: servings crosses Convex -> recipe-service -> store as a nullable
  // field. Absent must come back absent, not zero.
  it("create round-trips servings and omits it when unknown", async () => {
    const t = client();
    const withYield = await t.action(api.recipes.create, {
      title: "Chili",
      servings: 6,
      ingredients: [{ quantity: 1, unit: "lb", item: "beef" }],
    });
    created.push(withYield.id);
    expect(withYield.servings).toBe(6);

    const unknown = await t.action(api.recipes.create, {
      title: "Toast",
      ingredients: [{ quantity: 1, unit: "slice", item: "bread" }],
    });
    created.push(unknown.id);
    expect(unknown.servings).toBeUndefined();

    const list = await t.action(api.recipes.list, {});
    expect(list.find((r) => r.id === withYield.id)?.servings).toBe(6);
    expect(list.find((r) => r.id === unknown.id)?.servings).toBeUndefined();
  });

  it("update replaces servings, and clears it when omitted", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Chili",
      servings: 6,
      ingredients: [],
    });
    created.push(recipe.id);

    const rescaled = await t.action(api.recipes.update, {
      id: recipe.id,
      title: "Chili",
      servings: 8,
      ingredients: [],
    });
    expect(rescaled.servings).toBe(8);

    // Update replaces the whole recipe, so omitting servings clears the yield.
    const cleared = await t.action(api.recipes.update, {
      id: recipe.id,
      title: "Chili",
      ingredients: [],
    });
    expect(cleared.servings).toBeUndefined();
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

  it("listEquipment returns the curated hardware catalog", async () => {
    const t = client();
    const catalog = await t.action(api.recipes.listEquipment, {});
    expect(catalog.length).toBeGreaterThan(20);
    const oven = catalog.find((e) => e.id === "oven");
    expect(oven).toMatchObject({ name: "Oven", category: "appliance" });
  });

  it("carries equipment and method tags through create and update", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Tagged Pork",
      ingredients: [{ quantity: 2, unit: "kg", item: "pork shoulder" }],
      steps: ["Into the crock pot."],
      equipment: [
        { id: "slow_cooker", required: true },
        { id: "tongs", required: false },
      ],
      methods: ["slow_cook"],
    });
    created.push(recipe.id);

    // Sorted by slug, and the optional flag survives the round trip.
    expect(recipe.equipment).toEqual([
      { id: "slow_cooker", required: true },
      { id: "tongs", required: false },
    ]);
    expect(recipe.methods).toEqual(["slow_cook"]);

    const updated = await t.action(api.recipes.update, {
      id: recipe.id,
      title: "Tagged Pork",
      ingredients: [],
      equipment: [{ id: "smoker", required: true }],
      methods: ["smoke"],
    });
    // Tags replace rather than merge.
    expect(updated.equipment).toEqual([{ id: "smoker", required: true }]);
    expect(updated.methods).toEqual(["smoke"]);
  });

  it("rejects an equipment slug outside the curated catalog", async () => {
    const t = client();
    await expect(
      t.action(api.recipes.create, {
        title: "Bogus",
        ingredients: [],
        equipment: [{ id: "teleporter", required: true }],
      }),
    ).rejects.toThrow(/400/);
  });

  it("accepts an optional traceCtx without affecting the result (telemetry off)", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Traceparent Toast",
      ingredients: [{ quantity: 1, unit: "slice", item: "bread" }],
      traceCtx: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    created.push(recipe.id);
    expect(recipe.id).toBeTruthy();
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

  it("nutrition estimates a recipe, with coverage and per-ingredient provenance", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Pancakes",
      ingredients: [
        { quantity: 1, unit: "cup", item: "flour" },
        { quantity: 2, unit: "", item: "eggs" },
        { quantity: 1, unit: "pinch", item: "salt" },
      ],
    });
    created.push(recipe.id);

    const estimate = await t.action(api.recipes.nutrition, { id: recipe.id });

    // Energy is keyed by FDC nutrient number, never by a name of our own.
    expect(estimate.nutrients["1008"]).toMatchObject({ nutrientId: "1008", unit: "kcal" });
    expect(estimate.nutrients["1008"].amount).toBeGreaterThan(0);

    // Coverage is not optional: two of three lines resolve, and the pinch of
    // salt comes back named rather than silently dropped.
    expect(estimate.coverage).toMatchObject({ resolvedCount: 2, totalCount: 3 });
    expect(estimate.ingredients).toHaveLength(3);
    const salt = estimate.ingredients[2];
    expect(salt).toMatchObject({ item: "salt", resolved: false, grams: null });
    expect(salt.reason).toBeTruthy();

    // This recipe was created without a yield, so per-serving must be absent
    // rather than derived from a guessed serving count.
    expect(estimate.perServing).toBeUndefined();
    expect(estimate.servings).toBe(0);
  });

  it("nutrition divides by the recipe's yield when it has one", async () => {
    const t = client();
    const recipe = await t.action(api.recipes.create, {
      title: "Integration Pancakes (serves 4)",
      servings: 4,
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
    });
    created.push(recipe.id);

    const estimate = await t.action(api.recipes.nutrition, { id: recipe.id });

    expect(estimate.servings).toBe(4);
    expect(estimate.perServing).toBeDefined();
    // Totals are unaffected by the division.
    expect(estimate.perServing?.["1008"].amount).toBeCloseTo(
      estimate.nutrients["1008"].amount / 4,
      2,
    );
  });

  // Clone-on-add across the real service boundary (BL-0020). The catalog is
  // seeded by a separate command and is empty here, so this test creates the
  // source recipe under the SENTINEL catalog identity — which is also what
  // makes it a real test of the ownership quirk: recipe-service has to find a
  // recipe the caller does not own.
  describe("addFromCatalog", () => {
    const catalogClient = () =>
      convexTest(schema, modules).withIdentity({ subject: `${CATALOG_USER_ID}|session` });

    async function seedCatalogRecipe(title: string) {
      const rec = await catalogClient().action(api.recipes.create, {
        title,
        ingredients: [{ quantity: 2, unit: "cloves", item: "garlic" }],
        steps: ["Roast it."],
        cuisine: "Italian",
        totalMinutes: 25,
        tags: ["Vegetarian", "weeknight"],
      });
      return rec;
    }

    it("clones a catalog recipe into the caller's own recipes, with its metadata", async () => {
      const source = await seedCatalogRecipe("Contract Garlic Bread");
      catalogCreated.push(source.id);

      const clone = await client().action(api.recipes.addFromCatalog, {
        catalogRecipeId: source.id,
      });
      created.push(clone.id);

      expect(clone.id).not.toBe(source.id);
      expect(clone.userId).toBe("integration-user");
      expect(clone.sourceRecipeId).toBe(source.id);
      // Normalization happened server-side on the way in, so both sides agree.
      expect(clone.cuisine).toBe("italian");
      expect(clone.totalMinutes).toBe(25);
      expect(clone.tags).toEqual(["vegetarian", "weeknight"]);
      expect(clone.ingredients).toHaveLength(1);
      expect(clone.steps).toEqual(["Roast it."]);

      // The clone is the caller's own recipe, so it shows up in their list.
      const mine = await client().action(api.recipes.list, {});
      expect(mine.map((r) => r.id)).toContain(clone.id);
    });

    it("is idempotent: adding twice yields one recipe", async () => {
      const source = await seedCatalogRecipe("Contract Caesar Salad");
      catalogCreated.push(source.id);

      const first = await client().action(api.recipes.addFromCatalog, {
        catalogRecipeId: source.id,
      });
      created.push(first.id);
      const second = await client().action(api.recipes.addFromCatalog, {
        catalogRecipeId: source.id,
      });

      expect(second.id).toBe(first.id);
    });

    it("editing a clone leaves the shared catalog recipe untouched", async () => {
      const source = await seedCatalogRecipe("Contract Margherita");
      catalogCreated.push(source.id);
      const clone = await client().action(api.recipes.addFromCatalog, {
        catalogRecipeId: source.id,
      });
      created.push(clone.id);

      await client().action(api.recipes.update, {
        id: clone.id,
        title: "My Margherita",
        ingredients: [{ quantity: 1, unit: "", item: "dough" }],
        cuisine: "American",
      });

      const catalogNow = await catalogClient().action(api.recipes.list, {});
      const unchanged = catalogNow.find((r) => r.id === source.id);
      expect(unchanged?.title).toBe("Contract Margherita");
      expect(unchanged?.cuisine).toBe("italian");
    });

    it("rejects a recipe that is not in the catalog", async () => {
      const mine = await client().action(api.recipes.create, {
        title: "Not a catalog recipe",
        ingredients: [{ quantity: 1, unit: "", item: "flour" }],
      });
      created.push(mine.id);

      await expect(
        client().action(api.recipes.addFromCatalog, { catalogRecipeId: mine.id }),
      ).rejects.toThrow();
    });
  });

  it("nutrition 404s for a recipe the caller cannot see", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "other-user|session" });
    const mine = await client().action(api.recipes.create, {
      title: "Private",
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
    });
    created.push(mine.id);

    await expect(t.action(api.recipes.nutrition, { id: mine.id })).rejects.toThrow();
  });
});
