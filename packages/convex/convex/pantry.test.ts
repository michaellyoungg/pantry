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
});

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
