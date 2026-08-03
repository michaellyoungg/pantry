import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Clone-on-add (BL-0020). recipe-service is stubbed: what needs pinning here is
// the Convex-side consequence — that the recipe reaching the basket is the
// user's own clone and never the shared catalog id.
const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "user-a|session" };

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

const CLONE = {
  id: "r-clone-1",
  userId: "user-a",
  title: "Garlic Bread",
  ingredients: [],
  steps: [],
  equipment: [],
  methods: [],
  tags: ["vegetarian"],
  cuisine: "italian",
  totalMinutes: 20,
  sourceRecipeId: "cat-garlic-bread",
  createdAt: "2026-08-03T00:00:00.000Z",
};

beforeEach(() => {
  process.env.RECIPE_SERVICE_URL = "http://recipe-service.test";
  process.env.RECIPE_SERVICE_SECRET = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recipes.addFromCatalog", () => {
  it("baskets the user's clone, never the shared catalog id", async () => {
    stubRecipeService(CLONE, { status: 201 });
    const t = convexTest(schema, modules);

    const clone = await t
      .withIdentity(identity)
      .action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-garlic-bread" });
    expect(clone.id).toBe("r-clone-1");

    const basket = await t.withIdentity(identity).query(api.basket.list, {});
    expect(basket).toHaveLength(1);
    // The whole point: planning the catalog id would put a row owned by the
    // sentinel "catalog" user on the user's plan, which they could never edit.
    expect(basket[0].recipeId).toBe("r-clone-1");
    expect(basket[0].recipeId).not.toBe("cat-garlic-bread");
    expect(basket[0].title).toBe("Garlic Bread");
  });

  it("calls the catalog add endpoint with the catalog id", async () => {
    const fetchMock = stubRecipeService(CLONE, { status: 201 });
    const t = convexTest(schema, modules);

    await t
      .withIdentity(identity)
      .action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-garlic-bread" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://recipe-service.test/catalog/cat-garlic-bread/add");
    expect(init.method).toBe("POST");
  });

  it("adds nothing to the basket when the clone fails", async () => {
    stubRecipeService({ error: "catalog recipe not found" }, { status: 404 });
    const t = convexTest(schema, modules);

    await expect(
      t.withIdentity(identity).action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-nope" }),
    ).rejects.toThrow();

    const basket = await t.withIdentity(identity).query(api.basket.list, {});
    expect(basket).toHaveLength(0);
  });

  it("leaves one basket row when the same catalog recipe is added twice", async () => {
    // recipe-service returns the SAME clone the second time (its add is
    // idempotent), so the pair of calls must not accumulate basket rows.
    stubRecipeService(CLONE, { status: 200 });
    const t = convexTest(schema, modules);

    await t
      .withIdentity(identity)
      .action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-garlic-bread" });
    await t
      .withIdentity(identity)
      .action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-garlic-bread" });

    const basket = await t.withIdentity(identity).query(api.basket.list, {});
    expect(basket).toHaveLength(1);
  });

  it("requires authentication", async () => {
    stubRecipeService(CLONE, { status: 201 });
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.recipes.addFromCatalog, { catalogRecipeId: "cat-garlic-bread" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("recipes.create discovery metadata", () => {
  it("forwards cuisine, cook time, tags and source url to recipe-service", async () => {
    const fetchMock = stubRecipeService(CLONE, { status: 201 });
    const t = convexTest(schema, modules);

    await t.withIdentity(identity).action(api.recipes.create, {
      title: "Pad Thai",
      ingredients: [],
      cuisine: "Thai",
      totalMinutes: 35,
      tags: ["weeknight"],
      sourceUrl: "https://example.com/pad-thai",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      cuisine: "Thai",
      totalMinutes: 35,
      tags: ["weeknight"],
      sourceUrl: "https://example.com/pad-thai",
    });
  });

  it("sends empty collections rather than undefined when metadata is omitted", async () => {
    const fetchMock = stubRecipeService(CLONE, { status: 201 });
    const t = convexTest(schema, modules);

    await t.withIdentity(identity).action(api.recipes.create, { title: "Toast", ingredients: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tags).toEqual([]);
    expect(body.cuisine).toBe("");
    // Absent, not 0 — an unstated cook time is unknown, and 0 would be rejected.
    expect(body.totalMinutes).toBeUndefined();
  });
});
