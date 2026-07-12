import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { DEV_USER_ID } from "./constants";
import schema from "./schema";

// convex-test discovers the function modules via Vite's import.meta.glob.
// Must include the _generated directory; Vite glob doesn't support extglob
// negation, so we take all .js/.ts modules (the convention from Convex's docs).
const modules = import.meta.glob("./**/*.*s");

describe("groceryList", () => {
  it("returns the dev user's grocery rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: DEV_USER_ID,
        item: "flour",
        unit: "g",
        quantity: 500,
        checked: false,
      });
    });

    const rows = await t.query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item: "flour", unit: "g", quantity: 500, checked: false });
  });

  it("toggles an item's checked flag", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("groceryList", {
        userId: DEV_USER_ID,
        item: "eggs",
        unit: "count",
        quantity: 6,
        checked: false,
      }),
    );

    await t.mutation(api.groceryList.toggleItem, { id, checked: true });

    const rows = await t.query(api.groceryList.getGroceryList, {});
    expect(rows[0].checked).toBe(true);
  });

  it("clears every row for the user", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const item of ["flour", "sugar", "butter"]) {
        await ctx.db.insert("groceryList", {
          userId: DEV_USER_ID,
          item,
          unit: "g",
          quantity: 100,
          checked: false,
        });
      }
    });

    await t.mutation(api.groceryList.clearGroceryList, {});

    const rows = await t.query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(0);
  });
});
