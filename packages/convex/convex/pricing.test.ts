import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The store half of pricing (BL-0046). recipe-service is stubbed: what these
// pin is the Convex-side consequence of opting in — that a stored store reaches
// the estimate request, that no store means no store fields at all, and that
// one user's selection is invisible to another.
const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "user-a|session" };
const otherIdentity = { subject: "user-b|session" };

const ESTIMATE = {
  currency: "USD",
  totalCents: 250,
  pricedCount: 1,
  unpricedCount: 0,
  lines: [],
  basis: {
    source: "BLS",
    sourceUrl: "https://example.test",
    area: "U.S. city average",
    observationMonth: "2026-06",
    staleness: "fresh",
  },
};

function stubRecipeService(response: unknown, { status = 200 } = {}) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the nth recipe-service call. */
function sentBody(fetchMock: ReturnType<typeof stubRecipeService>, n = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

async function seedLine(t: ReturnType<typeof convexTest>, userId = "user-a") {
  await t.run(async (ctx) => {
    await ctx.db.insert("groceryList", {
      userId,
      item: "Eggs",
      canonicalItem: "eggs",
      unit: "",
      quantity: 12,
      aisle: "dairy",
      checked: false,
    });
  });
}

async function selectStore(t: ReturnType<typeof convexTest>) {
  await t.withIdentity(identity).mutation(api.pricing.selectStore, {
    provider: "kroger",
    locationId: "01400376",
    name: "Corryville",
    address: "1420 Vine St",
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

describe("pricing.estimateGroceryList", () => {
  it("sends no store for a user who never opted in", async () => {
    const fetchMock = stubRecipeService(ESTIMATE);
    const t = convexTest(schema, modules);
    await seedLine(t);

    await t.withIdentity(identity).action(api.pricing.estimateGroceryList, {});

    const body = sentBody(fetchMock);
    // Not merely absent from the response — absent from the request, so the
    // service never spends a call on a retailer for a user who did not ask.
    expect(body.storeLocationId).toBeUndefined();
    expect(body.storeProvider).toBeUndefined();
  });

  it("sends the chosen store once the user opts in", async () => {
    const fetchMock = stubRecipeService(ESTIMATE);
    const t = convexTest(schema, modules);
    await seedLine(t);
    await selectStore(t);

    await t.withIdentity(identity).action(api.pricing.estimateGroceryList, {});

    expect(sentBody(fetchMock)).toMatchObject({
      storeLocationId: "01400376",
      // The provider travels with the id: the same id means something else at
      // another retailer.
      storeProvider: "kroger",
    });
  });

  it("still excludes items the pantry says the user already has", async () => {
    const fetchMock = stubRecipeService(ESTIMATE);
    const t = convexTest(schema, modules);
    await seedLine(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: "user-a",
        item: "Flour",
        canonicalItem: "flour",
        unit: "g",
        quantity: 500,
        aisle: "baking",
        checked: false,
        alreadyHave: true,
      });
    });
    await selectStore(t);

    await t.withIdentity(identity).action(api.pricing.estimateGroceryList, {});

    const lines = sentBody(fetchMock).lines as { canonicalItem: string }[];
    expect(lines.map((l) => l.canonicalItem)).toEqual(["eggs"]);
  });
});

describe("pricing.estimateRecipe", () => {
  it("prices a recipe against the same store as the list", async () => {
    const fetchMock = stubRecipeService([]);
    const t = convexTest(schema, modules);
    await selectStore(t);

    await t.withIdentity(identity).action(api.pricing.estimateRecipe, { recipeId: "r1" });

    // Call 0 aggregates the recipe into lines; call 1 prices them.
    expect(sentBody(fetchMock, 1)).toMatchObject({
      storeLocationId: "01400376",
      storeProvider: "kroger",
    });
  });
});

describe("pricing store selection", () => {
  it("round-trips a selection and replaces it rather than accumulating", async () => {
    const t = convexTest(schema, modules);
    await selectStore(t);
    await t.withIdentity(identity).mutation(api.pricing.selectStore, {
      provider: "kroger",
      locationId: "01400943",
      name: "Hyde Park",
    });

    expect(await t.withIdentity(identity).query(api.pricing.getStore, {})).toMatchObject({
      provider: "kroger",
      locationId: "01400943",
      name: "Hyde Park",
    });
    const rows = await t.run(async (ctx) => ctx.db.query("storeSelection").collect());
    expect(rows).toHaveLength(1);
  });

  it("clears back to no store, which is the default", async () => {
    const t = convexTest(schema, modules);
    await selectStore(t);
    await t.withIdentity(identity).mutation(api.pricing.clearStore, {});

    expect(await t.withIdentity(identity).query(api.pricing.getStore, {})).toBeNull();
  });

  it("clearing when nothing is selected is not an error", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity(identity).mutation(api.pricing.clearStore, {})).resolves.toBeNull();
  });

  it("does not leak one user's store to another (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    await selectStore(t);

    expect(await t.withIdentity(otherIdentity).query(api.pricing.getStore, {})).toBeNull();

    // And clearing as the other user leaves the first user's row alone.
    await t.withIdentity(otherIdentity).mutation(api.pricing.clearStore, {});
    expect(await t.withIdentity(identity).query(api.pricing.getStore, {})).not.toBeNull();
  });

  it("rejects an unauthenticated selection", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.pricing.selectStore, { provider: "kroger", locationId: "x", name: "X" }),
    ).rejects.toThrow();
  });
});

describe("pricing.storeProvider and searchStores", () => {
  it("reports the feature flag through the service", async () => {
    stubRecipeService({ enabled: false, provider: "" });
    const t = convexTest(schema, modules);

    expect(await t.withIdentity(identity).action(api.pricing.storeProvider, {})).toEqual({
      enabled: false,
      provider: "",
    });
  });

  it("passes the zip through to the store search", async () => {
    const fetchMock = stubRecipeService({ provider: "kroger", stores: [] });
    const t = convexTest(schema, modules);

    await t.withIdentity(identity).action(api.pricing.searchStores, { zipCode: "45202" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://recipe-service.test/pricing/stores");
    expect(sentBody(fetchMock)).toMatchObject({ zipCode: "45202" });
  });
});
