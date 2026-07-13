import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the identity subject up to the "|" divider, so this
// resolves to the user id "user-a".
const identity = { subject: "user-a|session" };

async function seedBasket(t: ReturnType<typeof convexTest>, recipeId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("basket", { userId: "user-a", recipeId, title: `Recipe ${recipeId}` });
  });
}

describe("basket planner", () => {
  it("schedule assigns a weekday and defaults the slot to dinner", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.basket.schedule, { recipeId: "r1", weekday: 2 });

    const [row] = await asUser.query(api.basket.list, {});
    expect(row).toMatchObject({ recipeId: "r1", weekday: 2, slot: "dinner" });
  });

  it("schedule honors an explicit slot", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.basket.schedule, { recipeId: "r1", weekday: 0, slot: "lunch" });

    const [row] = await asUser.query(api.basket.list, {});
    expect(row.slot).toBe("lunch");
  });

  it("rejects an out-of-range weekday", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);

    await expect(
      asUser.mutation(api.basket.schedule, { recipeId: "r1", weekday: 7 }),
    ).rejects.toThrow(/weekday/);
  });

  it("unschedule clears the weekday/slot but keeps the recipe in the basket", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.schedule, { recipeId: "r1", weekday: 3 });

    await asUser.mutation(api.basket.unschedule, { recipeId: "r1" });

    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].weekday).toBeUndefined();
    expect(rows[0].slot).toBeUndefined();
  });

  it("schedule is a no-op when the recipe isn't in the basket", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.basket.schedule, { recipeId: "ghost", weekday: 1 });

    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(0);
  });
});

describe("basket servings & leftovers (increment 2)", () => {
  it("setServings clamps below 0.25", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.setServings, { recipeId: "r1", servingsMultiplier: 0 });
    const [row] = await asUser.query(api.basket.list, {});
    expect(row.servingsMultiplier).toBe(0.25);
  });

  it("setServings stores a valid multiplier", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.setServings, { recipeId: "r1", servingsMultiplier: 2 });
    const [row] = await asUser.query(api.basket.list, {});
    expect(row.servingsMultiplier).toBe(2);
  });

  it("setType marks a recipe as leftover and back to meal", async () => {
    const t = convexTest(schema, modules);
    await seedBasket(t, "r1");
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.setType, { recipeId: "r1", type: "leftover" });
    expect((await asUser.query(api.basket.list, {}))[0].type).toBe("leftover");
    await asUser.mutation(api.basket.setType, { recipeId: "r1", type: "meal" });
    expect((await asUser.query(api.basket.list, {}))[0].type).toBe("meal");
  });
});
