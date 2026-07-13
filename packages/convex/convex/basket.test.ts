import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("basket plan entries", () => {
  it("add inserts a new unscheduled meal entry each call (no dedupe)", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "meal", servingsMultiplier: 1 });
    expect(rows[0].plannedDate).toBeUndefined();
  });

  it("assignDay, setServings, setType patch a single entry", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.assignDay, { id, plannedDate: "2026-07-14" });
    await asUser.mutation(api.basket.setServings, { id, servingsMultiplier: 2 });
    await asUser.mutation(api.basket.setType, { id, type: "leftover" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows[0]).toMatchObject({
      plannedDate: "2026-07-14",
      servingsMultiplier: 2,
      type: "leftover",
    });
  });

  it("setServings clamps below 0.25", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.setServings, { id, servingsMultiplier: 0 });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows[0].servingsMultiplier).toBe(0.25);
  });

  it("remove(recipeId) deletes all entries for that recipe", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r2", title: "Soup" });
    await asUser.mutation(api.basket.remove, { recipeId: "r1" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeId).toBe("r2");
  });

  it("updateTitle(recipeId) renames all entries for that recipe", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.add, { recipeId: "r1", title: "Tacos" });
    await asUser.mutation(api.basket.updateTitle, { recipeId: "r1", title: "Fish Tacos" });
    const rows = await asUser.query(api.basket.list, {});
    expect(rows.every((r) => r.title === "Fish Tacos")).toBe(true);
  });
});
