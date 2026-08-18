import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { steppedDown } from "./pantry";
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

  it("lists items grouped by aisle, alphabetically within each aisle", async () => {
    const t = convexTest(schema, modules);

    // Seed items in an order that does NOT match the expected sorted output
    // This ensures the test fails if the sort comparator is removed
    await seed(t, { aisle: "produce", display: "Zucchini" });
    await seed(t, { aisle: "dairy", display: "Yogurt" });
    await seed(t, { aisle: "produce", display: "Apples" });
    await seed(t, { aisle: "dairy", display: "Butter" });

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});

    // Verify exact order: aisles grouped (dairy first, then produce),
    // and within each aisle sorted alphabetically by display name
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ aisle: "dairy", display: "Butter" });
    expect(rows[1]).toMatchObject({ aisle: "dairy", display: "Yogurt" });
    expect(rows[2]).toMatchObject({ aisle: "produce", display: "Apples" });
    expect(rows[3]).toMatchObject({ aisle: "produce", display: "Zucchini" });
  });

  it("flags a row to use up", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);

    await t.withIdentity(identity).mutation(api.pantry.setUseItUp, { id, useItUp: true });

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows[0].useItUp).toBe(true);
  });

  it("clears the use-it-up flag", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const client = t.withIdentity(identity);

    await client.mutation(api.pantry.setUseItUp, { id, useItUp: true });
    await client.mutation(api.pantry.setUseItUp, { id, useItUp: false });

    const rows = await client.query(api.pantry.list, {});
    expect(rows[0].useItUp).toBe(false);
  });

  it("refuses to flag another user's row", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { userId: "someone-else" });

    await expect(
      t.withIdentity(identity).mutation(api.pantry.setUseItUp, { id, useItUp: true }),
    ).rejects.toThrow("Not found");
  });
});

describe("pantry inflow from check-off", () => {
  async function seedLine(
    t: ReturnType<typeof convexTest>,
    over: Partial<{
      userId: string;
      item: string;
      canonicalItem: string | undefined;
      unit: string;
      quantity: number;
      aisle: string;
      checked: boolean;
    }> = {},
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

  it("keeps the pantry row while a sibling line with the same canonicalItem is still checked", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    // Two grocery lines share canonicalItem "garlic" but the Go aggregator
    // kept them separate because the units don't convert (cloves vs grams).
    const clovesId = await seedLine(t, {
      item: "Garlic",
      canonicalItem: "garlic",
      unit: "cloves",
      quantity: 2,
    });
    const gramsId = await seedLine(t, {
      item: "Garlic",
      canonicalItem: "garlic",
      unit: "grams",
      quantity: 10,
    });

    await asUser.mutation(api.groceryList.toggleItem, { id: clovesId, checked: true });
    await asUser.mutation(api.groceryList.toggleItem, { id: gramsId, checked: true });

    // Un-checking only the grams line must not delete the pantry row: the
    // cloves line is still checked and still claims the ingredient.
    await asUser.mutation(api.groceryList.toggleItem, { id: gramsId, checked: false });

    const afterFirstUncheck = await asUser.query(api.pantry.list, {});
    expect(afterFirstUncheck).toHaveLength(1);
    expect(afterFirstUncheck[0]).toMatchObject({ canonicalItem: "garlic", source: "auto" });

    // Now un-check the last remaining claim; the row should finally go away.
    await asUser.mutation(api.groceryList.toggleItem, { id: clovesId, checked: false });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });

  it("a still-checked line belonging to another user does not keep this user's row alive", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await seedLine(t, { canonicalItem: "garlic", unit: "cloves" });
    // Another user's checked line shares the same canonicalItem — the
    // by_user-scoped scan must not let it leak across users.
    await seedLine(t, {
      userId: "someone-else",
      canonicalItem: "garlic",
      unit: "grams",
      checked: true,
    });

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: false });

    expect(await asUser.query(api.pantry.list, {})).toHaveLength(0);
  });
});

describe("steppedDown", () => {
  it("steps have → low → out and stops there", () => {
    expect(steppedDown("have")).toBe("low");
    expect(steppedDown("low")).toBe("out");
    // The floor: there is nothing below "you're out of it".
    expect(steppedDown("out")).toBe("out");
  });
});

describe("cook-decrement (BL-0028)", () => {
  const originalFetch = globalThis.fetch;

  // markCooked *schedules* the decrement, so nothing runs until timers advance.
  // Without fake timers the scheduled action fires after the test (and after
  // the stubs below are torn down), which reads as "the decrement did nothing".
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  /**
   * Stubs POST /grocery-list, the endpoint cookDecrement reuses to turn a recipe
   * into normalized ingredient ids. Returns the recorded call bodies so a test
   * can assert recipe-service was never called at all.
   */
  function stubIngredients(canonicalItems: string[]) {
    vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
    vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(init.body as string) });
      const lines = canonicalItems.map((canonicalItem) => ({
        item: canonicalItem,
        canonicalItem,
        unit: "g",
        quantity: 1,
        aisle: "other",
      }));
      return new Response(JSON.stringify(lines), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  async function seedPlanned(
    t: ReturnType<typeof convexTest>,
    over: Partial<{ userId: string; type: "meal" | "leftover" }> = {},
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("basket", {
        userId: USER_ID,
        recipeId: "r1",
        title: "Buttered Spinach",
        weekday: 2,
        ...over,
      });
    });
  }

  /** Marks r1 cooked and drains the decrement the mutation scheduled. */
  async function cook(t: ReturnType<typeof convexTest>) {
    await t.withIdentity(identity).mutation(api.basket.markCooked, { recipeId: "r1" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  it("steps each of the recipe's ingredients one notch", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter", "spinach"]);
    await seedPlanned(t);
    await seed(t, { canonicalItem: "butter", display: "Butter", state: "have" });
    await seed(t, { canonicalItem: "spinach", display: "Spinach", state: "low" });

    await cook(t);

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows.map((r) => [r.canonicalItem, r.state])).toEqual([
      ["butter", "low"],
      ["spinach", "out"],
    ]);
  });

  // Cooking a meal is the strongest taste signal the product has, and this is
  // the ONE place that already knows the recipe's normalized ingredients — the
  // affinity fold needs them and a mutation cannot fetch (BL-0005 increment 2).
  it("records a cooked interaction with the resolved ingredients", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter", "spinach"]);
    await seedPlanned(t);
    await seed(t, { canonicalItem: "butter", display: "Butter", state: "have" });

    await cook(t);

    const events = await t.run(async (ctx) => ctx.db.query("recommendationEvents").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: USER_ID,
      recipeId: "r1",
      action: "cooked",
      canonicalItems: ["butter", "spinach"],
    });
  });

  it("never steps below out", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t, { state: "out" });

    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row.state).toBe("out");
  });

  it("keys on canonicalItem, not the display string", async () => {
    const t = convexTest(schema, modules);
    // recipe-service normalizes "Green onions" to "green onion"; the pantry row
    // stores the same canonical key with a different display. Matching on
    // display would step nothing and fail silently.
    stubIngredients(["green onion"]);
    await seedPlanned(t);
    await seed(t, { canonicalItem: "green onion", display: "Green onions" });

    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row.state).toBe("low");
  });

  it("marking the same recipe cooked twice does not double-step", async () => {
    const t = convexTest(schema, modules);
    const calls = stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t, { state: "have" });

    await cook(t);
    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row.state).toBe("low");
    // The guard fires before the schedule, so the second cook never even asks
    // recipe-service for the ingredients.
    expect(calls).toHaveLength(1);
  });

  it("steps again after an explicit unmark — that is a second asserted cook", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t, { state: "have" });

    await cook(t);
    await t.withIdentity(identity).mutation(api.basket.unmarkCooked, { recipeId: "r1" });
    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row.state).toBe("out");
  });

  it("does not create pantry rows for ingredients the user never tracked", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter", "saffron"]);
    await seedPlanned(t);
    await seed(t, { canonicalItem: "butter", state: "have" });

    await cook(t);

    const rows = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonicalItem: "butter", state: "low" });
  });

  it("steps a manually curated row too — cooking consumes food whoever entered it", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t, { source: "manual", state: "have" });

    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row).toMatchObject({ source: "manual", state: "low" });
  });

  it("leaves another user's row for the same ingredient alone", async () => {
    const t = convexTest(schema, modules);
    stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t, { state: "have" });
    await seed(t, { userId: "someone-else", state: "have" });

    await cook(t);

    const rows = await t.run(async (ctx) => await ctx.db.query("pantryItems").collect());
    expect(rows.find((r) => r.userId === USER_ID)?.state).toBe("low");
    expect(rows.find((r) => r.userId === "someone-else")?.state).toBe("have");
  });

  it("does not decrement for a leftover — reheating consumes nothing new", async () => {
    const t = convexTest(schema, modules);
    const calls = stubIngredients(["butter"]);
    await seedPlanned(t, { type: "leftover" });
    await seed(t, { state: "have" });

    await cook(t);

    const [row] = await t.withIdentity(identity).query(api.pantry.list, {});
    expect(row.state).toBe("have");
    expect(calls).toHaveLength(0);
    // The plan record still says it was eaten.
    const [planned] = await t.withIdentity(identity).query(api.basket.list, {});
    expect(planned.cookedAt).toBeTypeOf("number");
  });

  it("asks recipe-service for exactly the cooked recipe, at multiplier 1", async () => {
    const t = convexTest(schema, modules);
    const calls = stubIngredients(["butter"]);
    await seedPlanned(t);
    await seed(t);

    await cook(t);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://recipe-service/grocery-list");
    expect(calls[0].body).toEqual({ items: [{ recipeId: "r1", multiplier: 1 }] });
  });
});
