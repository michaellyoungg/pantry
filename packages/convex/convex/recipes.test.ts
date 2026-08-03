import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Referential-integrity unit tests for BL-0013. recipe-service is stubbed here
// on purpose: the cross-service contract is covered by
// recipes.integration.test.ts, whereas what we need to pin is the Convex-side
// consequence of a successful delete/rename — that the basket (which doubles as
// the week plan) can't be left holding a recipeId no database enforces.
const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the identity subject up to the "|" divider, so this
// resolves to the user id "user-a".
const identity = { subject: "user-a|session" };

/** Stubs recipe-service. `fail` makes every call reject, as if it were down. */
function stubRecipeService(response: unknown, { status = 200 } = {}) {
  const fetchMock = vi.fn(async () =>
    status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(response), {
          status,
          headers: { "content-type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function seedBasket(t: ReturnType<typeof convexTest>, recipeId: string, title: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("basket", { userId: "user-a", recipeId, title, weekday: 2 });
  });
}

beforeEach(() => {
  process.env.RECIPE_SERVICE_URL = "http://recipe-service.test";
  process.env.RECIPE_SERVICE_SECRET = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recipes.remove referential integrity", () => {
  it("drops the basket/week-plan row pointing at the deleted recipe", async () => {
    stubRecipeService(null, { status: 204 });
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1", "Garlic Bread");
    await seedBasket(t, "r2", "Soup");
    const asUser = t.withIdentity(identity);

    await asUser.action(api.recipes.remove, { id: "r1" });

    const rows = await asUser.query(api.basket.list, {});
    expect(rows.map((r) => r.recipeId)).toEqual(["r2"]);
  });

  it("is a no-op when the deleted recipe was never basketed", async () => {
    stubRecipeService(null, { status: 204 });
    const t = convexTest(schema, modules);
    await seedBasket(t, "r2", "Soup");
    const asUser = t.withIdentity(identity);

    await asUser.action(api.recipes.remove, { id: "r1" });

    const rows = await asUser.query(api.basket.list, {});
    expect(rows.map((r) => r.recipeId)).toEqual(["r2"]);
  });

  it("leaves the basket alone when the recipe delete itself fails", async () => {
    stubRecipeService({ error: "boom" }, { status: 500 });
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1", "Garlic Bread");
    const asUser = t.withIdentity(identity);

    await expect(asUser.action(api.recipes.remove, { id: "r1" })).rejects.toThrow();

    // The recipe still exists, so its basket row must survive too.
    const rows = await asUser.query(api.basket.list, {});
    expect(rows.map((r) => r.recipeId)).toEqual(["r1"]);
  });
});

describe("recipes.update referential integrity", () => {
  it("syncs the denormalized basket title on rename", async () => {
    stubRecipeService({
      id: "r1",
      userId: "user-a",
      title: "Cheesy Garlic Bread",
      ingredients: [],
      createdAt: "2026-06-30T00:00:00.000Z",
    });
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1", "Garlic Bread");
    const asUser = t.withIdentity(identity);

    const updated = await asUser.action(api.recipes.update, {
      id: "r1",
      title: "Cheesy Garlic Bread",
      ingredients: [],
    });

    expect(updated.title).toBe("Cheesy Garlic Bread");
    const [row] = await asUser.query(api.basket.list, {});
    // The week-plan placement must be preserved by the retitle.
    expect(row).toMatchObject({ title: "Cheesy Garlic Bread", weekday: 2 });
  });
});
