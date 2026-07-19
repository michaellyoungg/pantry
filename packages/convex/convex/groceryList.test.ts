import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers the function modules via Vite's import.meta.glob.
// Must include the _generated directory; Vite glob doesn't support extglob
// negation, so we take all .js/.ts modules (the convention from Convex's docs).
const modules = import.meta.glob("./**/*.*s");

// getAuthUserId returns the identity subject up to the "|" divider, so this
// subject resolves to the user id "user-a".
const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

describe("groceryList", () => {
  it("returns the authenticated user's grocery rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "flour",
        unit: "g",
        quantity: 500,
        aisle: "pantry",
        checked: false,
      });
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item: "flour",
      unit: "g",
      quantity: 500,
      aisle: "pantry",
      checked: false,
    });
  });

  it("toggles an item's checked flag for the owner", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "eggs",
        unit: "count",
        quantity: 6,
        aisle: "other",
        checked: false,
      }),
    );

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].checked).toBe(true);
  });

  it("rejects toggling another user's item (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("groceryList", {
        userId: "someone-else",
        item: "eggs",
        unit: "count",
        quantity: 6,
        aisle: "other",
        checked: false,
      }),
    );

    await expect(
      t.withIdentity(identity).mutation(api.groceryList.toggleItem, { id, checked: true }),
    ).rejects.toThrow();
  });

  it("clears every row for the user", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const item of ["flour", "sugar", "butter"]) {
        await ctx.db.insert("groceryList", {
          userId: USER_ID,
          item,
          unit: "g",
          quantity: 100,
          aisle: "pantry",
          checked: false,
        });
      }
    });

    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.groceryList.clearGroceryList, {});

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(0);
  });
});

describe("mergeGroceryList (increment 2)", () => {
  it("preserves checked state for surviving lines, inserts new, deletes gone", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: true,
      });
      await ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "Eggs",
        unit: "count",
        quantity: 6,
        aisle: "other",
        checked: false,
      });
    });
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
        { item: "Bread", canonicalItem: "bread", unit: "loaf", quantity: 1, aisle: "bakery" },
      ],
    });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(Object.keys(byItem).sort()).toEqual(["Bread", "Milk"]);
    expect(byItem.Milk).toMatchObject({ quantity: 2, checked: true });
    expect(byItem.Bread).toMatchObject({ checked: false });
  });

  it("persists canonicalItem on inserted lines", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Green onion", canonicalItem: "green onion", unit: "bunch", quantity: 2, aisle: "produce" },
      ],
    });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalItem).toBe("green onion");
  });
});
