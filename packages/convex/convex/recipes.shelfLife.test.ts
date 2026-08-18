import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

/**
 * generateGroceryList is the only place shelf life can be resolved: check-off is
 * a mutation and mutations cannot fetch, so the number has to be persisted onto
 * the line during generation. These tests pin that wiring with a stubbed
 * recipe-service; the live contract is covered by recipes.integration.test.ts.
 */
describe("generateGroceryList shelf-life lookup (BL-0029)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function stubService(routes: Record<string, unknown>) {
    vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
    vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
    const paths: string[] = [];
    globalThis.fetch = (async (url: string) => {
      const path = String(url).replace("http://recipe-service", "");
      paths.push(path);
      return new Response(JSON.stringify(routes[path] ?? null), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return paths;
  }

  async function basketOne(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("basket", { userId: USER_ID, recipeId: "r1", title: "Salad" });
    });
  }

  it("stamps looked-up shelf life onto the generated lines", async () => {
    const t = convexTest(schema, modules);
    await basketOne(t);
    stubService({
      "/grocery-list": [
        { item: "Spinach", canonicalItem: "spinach", unit: "g", quantity: 200, aisle: "produce" },
        { item: "Sriracha", canonicalItem: "sriracha", unit: "", quantity: 1, aisle: "other" },
      ],
      "/normalization/lookup": {
        items: [
          { canonicalItem: "spinach", display: "Spinach", aisle: "produce", shelfLifeDays: 5 },
          { canonicalItem: "sriracha", display: "Sriracha", aisle: "other" },
        ],
      },
    });

    const asUser = t.withIdentity(identity);
    await asUser.action(api.recipes.generateGroceryList, {});

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(byItem.Spinach.shelfLifeDays).toBe(5);
    expect(byItem.Sriracha.shelfLifeDays).toBeUndefined();
  });

  it("asks for each canonical item exactly once", async () => {
    const t = convexTest(schema, modules);
    await basketOne(t);
    let asked: unknown;
    vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
    vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const path = String(url).replace("http://recipe-service", "");
      if (path === "/normalization/lookup") asked = JSON.parse(init.body as string);
      const body =
        path === "/grocery-list"
          ? [
              {
                item: "Garlic",
                canonicalItem: "garlic",
                unit: "clove",
                quantity: 2,
                aisle: "produce",
              },
              { item: "Garlic", canonicalItem: "garlic", unit: "g", quantity: 5, aisle: "produce" },
            ]
          : { items: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await t.withIdentity(identity).action(api.recipes.generateGroceryList, {});

    expect(asked).toEqual({ items: ["garlic"] });
  });

  it("still produces a list when the lookup finds nothing", async () => {
    const t = convexTest(schema, modules);
    await basketOne(t);
    stubService({
      "/grocery-list": [
        { item: "Sriracha", canonicalItem: "sriracha", unit: "", quantity: 1, aisle: "other" },
      ],
      "/normalization/lookup": { items: [] },
    });

    const asUser = t.withIdentity(identity);
    const result = await asUser.action(api.recipes.generateGroceryList, {});

    expect(result.count).toBe(1);
    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].shelfLifeDays).toBeUndefined();
  });
});
