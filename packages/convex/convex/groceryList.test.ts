import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("stamps every toggle with the server clock, so an offline replay can tell who spoke last", async () => {
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
    // Never ticked, so there is nothing to compare against yet (BL-0058).
    expect((await asUser.query(api.groceryList.getGroceryList, {}))[0].checkedAt).toBeUndefined();

    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    const first = (await asUser.query(api.groceryList.getGroceryList, {}))[0].checkedAt;
    expect(first).toBeGreaterThan(0);

    // A toggle that lands on the value already there still counts as somebody
    // speaking about the line — leaving the stamp alone would read as silence
    // to a device deciding whether its queued intent is still current.
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    const second = (await asUser.query(api.groceryList.getGroceryList, {}))[0].checkedAt;
    expect(second).toBeGreaterThanOrEqual(first ?? 0);
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
        {
          item: "Green onion",
          canonicalItem: "green onion",
          unit: "bunch",
          quantity: 2,
          aisle: "produce",
        },
      ],
    });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalItem).toBe("green onion");
  });

  it("heals canonicalItem onto rows written before the field existed", async () => {
    const t = convexTest(schema, modules);
    // Insert a legacy row without canonicalItem (simulating pre-BL-0021 rows)
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", {
        userId: USER_ID,
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
      }); // canonicalItem is optional on the table, so a legacy row omits it
    });

    // Merge with a line that provides canonicalItem
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [{ item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" }],
    });

    // Verify the row was healed to include canonicalItem
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item: "Milk",
      canonicalItem: "milk",
      quantity: 2,
      aisle: "dairy",
    });
  });
});

describe("removed lines (BL-0018 diff-merge rule 3)", () => {
  const checkedMilk = {
    userId: USER_ID,
    item: "Milk",
    canonicalItem: "milk",
    unit: "cup",
    quantity: 1,
    aisle: "dairy",
    checked: true,
  };
  const bread = {
    item: "Bread",
    canonicalItem: "bread",
    unit: "loaf",
    quantity: 1,
    aisle: "bakery",
  };

  it("flags a checked line the plan no longer wants instead of deleting it", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("groceryList", checkedMilk));

    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [bread] });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const milk = rows.find((r) => r.item === "Milk");
    expect(milk).toBeDefined();
    expect(milk?.checked).toBe(true);
    expect(milk?.removed).toBe(true);
  });

  it("clears the flag when the line returns to the plan, keeping the tick", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("groceryList", { ...checkedMilk, removed: true }));

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [{ item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 3, aisle: "dairy" }],
    });

    const [milk] = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(milk.removed).toBeUndefined();
    expect(milk.checked).toBe(true);
    expect(milk.quantity).toBe(3);
  });

  it("still deletes an untouched line the plan no longer wants", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("groceryList", { ...checkedMilk, checked: false }));

    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [bread] });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.map((r) => r.item)).toEqual(["Bread"]);
  });

  it("lets the shopper dismiss a flagged line", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("groceryList", { ...checkedMilk, removed: true }));
    const asUser = t.withIdentity(identity);
    const [milk] = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.removeItem, { id: milk._id });

    expect(await asUser.query(api.groceryList.getGroceryList, {})).toHaveLength(0);
  });

  it("still refuses to remove a generated line that is still in the plan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => ctx.db.insert("groceryList", checkedMilk));
    const asUser = t.withIdentity(identity);
    const [milk] = await asUser.query(api.groceryList.getGroceryList, {});

    await expect(asUser.mutation(api.groceryList.removeItem, { id: milk._id })).rejects.toThrow();
  });
});

describe("don't-rebuy (BL-0021)", () => {
  async function seedPantry(
    t: ReturnType<typeof convexTest>,
    canonicalItem: string,
    state: "have" | "low" | "out",
  ) {
    await t.run(async (ctx) =>
      ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem,
        display: canonicalItem,
        aisle: "dairy",
        state,
        source: "manual" as const,
        updatedAt: 0,
      }),
    );
  }

  it("flags lines the user already has", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(byItem.Butter.alreadyHave).toBe(true);
    expect(byItem.Milk.alreadyHave).toBe(false);
  });

  it("does not flag items that are low or out", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "low");
    await seedPantry(t, "milk", "out");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.every((r) => r.alreadyHave === false)).toBe(true);
  });

  it("never drops or reorders lines", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
        { item: "Milk", canonicalItem: "milk", unit: "cup", quantity: 2, aisle: "dairy" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.map((r) => r.item)).toEqual(["Butter", "Milk"]);
  });

  it("needItAnyway clears the flag without touching the pantry row", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Butter", canonicalItem: "butter", unit: "cup", quantity: 1, aisle: "dairy" },
      ],
    });
    const asUser = t.withIdentity(identity);
    const [line] = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.needItAnyway, { id: line._id });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].alreadyHave).toBe(false);
    expect(await asUser.query(api.pantry.list, {})).toHaveLength(1);
  });

  it("preserves a needItAnyway override across regeneration", async () => {
    const t = convexTest(schema, modules);
    await seedPantry(t, "butter", "have");
    const line = {
      item: "Butter",
      canonicalItem: "butter",
      unit: "cup",
      quantity: 1,
      aisle: "dairy",
    };
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });
    const asUser = t.withIdentity(identity);
    const [row] = await asUser.query(api.groceryList.getGroceryList, {});
    await asUser.mutation(api.groceryList.needItAnyway, { id: row._id });

    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0].alreadyHave).toBe(false);
  });
});

describe("shelf life & use-by (BL-0029)", () => {
  const DAY = 86_400_000;

  it("persists shelfLifeDays from the lookup onto inserted lines", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Spinach", canonicalItem: "spinach", unit: "g", quantity: 200, aisle: "produce" },
        { item: "Sriracha", canonicalItem: "sriracha", unit: "", quantity: 1, aisle: "other" },
      ],
      shelfLife: { spinach: 5 },
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    expect(byItem.Spinach.shelfLifeDays).toBe(5);
    expect(byItem.Sriracha.shelfLifeDays).toBeUndefined();
  });

  it("stamps an approximate useBy on the pantry row when a line is checked off", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Spinach", canonicalItem: "spinach", unit: "g", quantity: 200, aisle: "produce" },
      ],
      shelfLife: { spinach: 5 },
    });
    const asUser = t.withIdentity(identity);
    const [line] = await asUser.query(api.groceryList.getGroceryList, {});

    const before = Date.now();
    await asUser.mutation(api.groceryList.toggleItem, { id: line._id, checked: true });

    const [row] = await asUser.query(api.pantry.list, {});
    expect(row.useBy).toBeGreaterThanOrEqual(before + 5 * DAY);
    expect(row.useBy).toBeLessThanOrEqual(Date.now() + 5 * DAY);
  });

  it("leaves useBy unset for an item with no known shelf life", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Sriracha", canonicalItem: "sriracha", unit: "", quantity: 1, aisle: "other" },
      ],
    });
    const asUser = t.withIdentity(identity);
    const [line] = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.toggleItem, { id: line._id, checked: true });

    const [row] = await asUser.query(api.pantry.list, {});
    expect(row.canonicalItem).toBe("sriracha");
    expect(row.useBy).toBeUndefined();
  });

  it("restarts the clock when the item is bought again", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem: "spinach",
        display: "Spinach",
        aisle: "produce",
        state: "out" as const,
        source: "auto" as const,
        updatedAt: 0,
        useBy: 1000, // long past
      }),
    );
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Spinach", canonicalItem: "spinach", unit: "g", quantity: 200, aisle: "produce" },
      ],
      shelfLife: { spinach: 5 },
    });
    const asUser = t.withIdentity(identity);
    const [line] = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.toggleItem, { id: line._id, checked: true });

    const [row] = await asUser.query(api.pantry.list, {});
    expect(row.state).toBe("have");
    expect(row.useBy).toBeGreaterThan(Date.now());
  });
});

// Provenance (BL-0019): the aggregator now says which recipes each line came
// from, and that has to survive the non-destructive merge, not just the insert.
describe("grocery line provenance", () => {
  const line = {
    item: "Garlic",
    canonicalItem: "garlic",
    unit: "cloves",
    quantity: 3,
    aisle: "produce",
    sources: [
      { recipeId: "r1", title: "Chili", quantity: 2 },
      { recipeId: "r2", title: "Aioli", quantity: 1 },
    ],
  };

  it("persists contributing recipes on a newly generated line", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows[0].sources).toEqual(line.sources);
  });

  it("refreshes provenance when a line is re-generated", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [line] });
    // The plan changed: Aioli is gone, so the line is smaller and traces to one
    // recipe. A stale second source would send the shopper to a recipe they are
    // no longer cooking.
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [{ ...line, quantity: 2, sources: [{ recipeId: "r1", title: "Chili", quantity: 2 }] }],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toEqual([{ recipeId: "r1", title: "Chili", quantity: 2 }]);
  });
});

describe("manual grocery lines", () => {
  async function addManual(t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) {
    await t.mutation(internal.groceryList.insertManualLine, {
      userId: USER_ID,
      item: "Foil",
      canonicalItem: "foil",
      unit: "",
      quantity: 1,
      aisle: "other",
      ...over,
    });
  }

  it("inserts a manual line flagged as manual and unchecked", async () => {
    const t = convexTest(schema, modules);
    await addManual(t);

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows[0]).toMatchObject({ item: "Foil", aisle: "other", checked: false, manual: true });
  });

  it("adds to the existing line instead of opening a second one", async () => {
    const t = convexTest(schema, modules);
    await addManual(t, { quantity: 1 });
    await addManual(t, { quantity: 2 });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
  });

  it("un-checks a line that is re-added, because you want more of it", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await addManual(t);
    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    await asUser.mutation(api.groceryList.toggleItem, { id: rows[0]._id, checked: true });

    await addManual(t);

    const after = await asUser.query(api.groceryList.getGroceryList, {});
    expect(after[0].checked).toBe(false);
    expect(after[0].quantity).toBe(2);
  });

  it("survives a re-generation that does not mention it", async () => {
    const t = convexTest(schema, modules);
    await addManual(t);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Garlic", canonicalItem: "garlic", unit: "cloves", quantity: 3, aisle: "produce" },
      ],
    });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.map((r) => r.item).sort()).toEqual(["Foil", "Garlic"]);
  });

  it("still deletes generated lines the new plan dropped", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Garlic", canonicalItem: "garlic", unit: "cloves", quantity: 3, aisle: "produce" },
      ],
    });
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [] });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(0);
  });

  it("drops provenance from a manual line whose recipe left the plan", async () => {
    const t = convexTest(schema, modules);
    // Typed by hand, then a recipe wanted the same thing: the line keeps both
    // its manual protection and the recipe's provenance.
    await addManual(t, {
      item: "Garlic",
      canonicalItem: "garlic",
      unit: "cloves",
      aisle: "produce",
    });
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        {
          item: "Garlic",
          canonicalItem: "garlic",
          unit: "cloves",
          quantity: 3,
          aisle: "produce",
          sources: [{ recipeId: "r1", title: "Chili", quantity: 3 }],
        },
      ],
    });
    let rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows[0].sources).toHaveLength(1);
    expect(rows[0].manual).toBe(true);

    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [] });

    rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toBeUndefined();
  });

  it("removes a manual line", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await addManual(t);
    const rows = await asUser.query(api.groceryList.getGroceryList, {});

    await asUser.mutation(api.groceryList.removeItem, { id: rows[0]._id });

    expect(await asUser.query(api.groceryList.getGroceryList, {})).toHaveLength(0);
  });

  it("refuses to remove a generated line, which would just come back", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: USER_ID,
      lines: [
        { item: "Garlic", canonicalItem: "garlic", unit: "cloves", quantity: 3, aisle: "produce" },
      ],
    });
    const rows = await asUser.query(api.groceryList.getGroceryList, {});

    await expect(asUser.mutation(api.groceryList.removeItem, { id: rows[0]._id })).rejects.toThrow(
      /manually added/,
    );
  });
});

describe("recent item suggestions", () => {
  it("offers the most recently touched pantry items, newest first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem: "butter",
        display: "Butter",
        aisle: "dairy",
        state: "have",
        source: "auto",
        updatedAt: 100,
      });
      await ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem: "milk",
        display: "Milk",
        aisle: "dairy",
        state: "have",
        source: "auto",
        updatedAt: 200,
      });
    });

    const recent = await t.withIdentity(identity).query(api.groceryList.recentItems, {});
    expect(recent.map((r) => r.display)).toEqual(["Milk", "Butter"]);
  });

  it("does not suggest something already on the list", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("pantryItems", {
        userId: USER_ID,
        canonicalItem: "milk",
        display: "Milk",
        aisle: "dairy",
        state: "have",
        source: "auto",
        updatedAt: 200,
      });
    });
    await t.mutation(internal.groceryList.insertManualLine, {
      userId: USER_ID,
      item: "Milk",
      canonicalItem: "milk",
      unit: "",
      quantity: 1,
      aisle: "dairy",
    });

    const recent = await t.withIdentity(identity).query(api.groceryList.recentItems, {});
    expect(recent).toEqual([]);
  });

  it("keeps another household's pantry out of the suggestions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("pantryItems", {
        userId: "user-b",
        canonicalItem: "milk",
        display: "Milk",
        aisle: "dairy",
        state: "have",
        source: "auto",
        updatedAt: 200,
      });
    });

    expect(await t.withIdentity(identity).query(api.groceryList.recentItems, {})).toEqual([]);
  });
});

// addManualItem is an action because categorisation needs recipe-service's
// normalization table, and mutations cannot fetch. These pin the wiring with a
// stubbed service; the live contract is covered by the integration suite.
describe("addManualItem", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function stubNormalization(items: unknown[]) {
    vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
    vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return bodies;
  }

  it("files a typed item into the aisle recipe-service resolves for it", async () => {
    const t = convexTest(schema, modules);
    const bodies = stubNormalization([
      { canonicalItem: "green onion", display: "Green onion", aisle: "produce", shelfLifeDays: 7 },
    ]);

    await t
      .withIdentity(identity)
      .action(api.groceryList.addManualItem, { item: "scallions", quantity: 2, unit: "bunch" });

    expect(bodies[0]).toEqual({ items: ["scallions"] });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows[0]).toMatchObject({
      item: "Green onion",
      canonicalItem: "green onion",
      aisle: "produce",
      unit: "bunch",
      quantity: 2,
      manual: true,
      // Carried so check-off can stamp a use-by without a second round trip.
      shelfLifeDays: 7,
    });
  });

  it("still adds an item the normalizer returns nothing for", async () => {
    const t = convexTest(schema, modules);
    stubNormalization([]);

    await t
      .withIdentity(identity)
      .action(api.groceryList.addManualItem, { item: "Sriracha", quantity: 1, unit: "" });

    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows[0]).toMatchObject({ item: "Sriracha", canonicalItem: "sriracha", aisle: "other" });
  });

  it("rejects a blank item without calling the service", async () => {
    const t = convexTest(schema, modules);
    const bodies = stubNormalization([]);

    await expect(
      t
        .withIdentity(identity)
        .action(api.groceryList.addManualItem, { item: "   ", quantity: 1, unit: "" }),
    ).rejects.toThrow(/required/);
    expect(bodies).toEqual([]);
  });

  it("refuses to add for a signed-out caller", async () => {
    const t = convexTest(schema, modules);
    stubNormalization([]);

    await expect(
      t.action(api.groceryList.addManualItem, { item: "Foil", quantity: 1, unit: "" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("purchase units and inferred leftovers", () => {
  // "2 tbsp parsley" needed, one half-cup bunch bought, 6 tbsp left over.
  const parsley = {
    item: "Parsley",
    canonicalItem: "parsley",
    unit: "tbsp",
    quantity: 2,
    aisle: "produce",
    purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
  };

  async function generate(t: ReturnType<typeof convexTest>, lines = [parsley]) {
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    return rows[0];
  }

  it("persists what to buy alongside what the recipes need", async () => {
    const t = convexTest(schema, modules);
    const row = await generate(t);

    expect(row.purchase).toEqual(parsley.purchase);
    // The need is untouched: provenance and pricing are built on it.
    expect(row.quantity).toBe(2);
    expect(row.unit).toBe("tbsp");
  });

  it("refreshes the pack count when the plan grows", async () => {
    const t = convexTest(schema, modules);
    await generate(t);
    const row = await generate(t, [
      { ...parsley, quantity: 12, purchase: { quantity: 2, unit: "bunch", residue: 4 } },
    ]);

    expect(row.purchase).toEqual({ quantity: 2, unit: "bunch", residue: 4 });
  });

  it("proposes nothing until the line is actually bought", async () => {
    const t = convexTest(schema, modules);
    await generate(t);

    const proposals = await t.withIdentity(identity).query(api.groceryList.leftoverProposals, {});
    expect(proposals).toEqual([]);
  });

  it("proposes the leftover once the line is checked off", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });

    const proposals = await asUser.query(api.groceryList.leftoverProposals, {});
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      item: "Parsley",
      purchase: { residue: 6, residueUnit: "tbsp" },
      quantity: 2,
      unit: "tbsp",
    });
  });

  it("proposes nothing for a line whose pack was an exact fit", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t, [
      { ...parsley, quantity: 8, purchase: { quantity: 1, unit: "bunch" } },
    ]);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });

    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });

  it("proposes nothing for a bought line the plan has since dropped", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });
    // The recipe left the plan, so it never ran and its residue is fiction.
    await t.mutation(internal.groceryList.mergeGroceryList, { userId: USER_ID, lines: [] });

    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });

  it("writes useItUp through to the pantry when the user confirms", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });

    await asUser.mutation(api.groceryList.resolveLeftover, { id: row._id, keep: true });

    const pantry = await asUser.query(api.pantry.list, {});
    expect(pantry).toHaveLength(1);
    expect(pantry[0]).toMatchObject({ canonicalItem: "parsley", useItUp: true, state: "have" });
    // Answered, so it stops being asked.
    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });

  it("leaves the pantry alone when the user dismisses", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });

    await asUser.mutation(api.groceryList.resolveLeftover, { id: row._id, keep: false });

    const pantry = await asUser.query(api.pantry.list, {});
    // The check-off row is still there — the user owns parsley — but nothing
    // claims there is a usable leftover.
    expect(pantry[0].useItUp).toBeUndefined();
    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });

  it("re-asks after the line is un-checked and bought again", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });
    await asUser.mutation(api.groceryList.resolveLeftover, { id: row._id, keep: false });
    // Un-checking says the purchase never happened, so the answer about its
    // leftovers is about a shop that no longer exists.
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: false });
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });

    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toHaveLength(1);
  });

  it("survives a re-generation without re-asking a question already answered", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const row = await generate(t);
    await asUser.mutation(api.groceryList.toggleItem, { id: row._id, checked: true });
    await asUser.mutation(api.groceryList.resolveLeftover, { id: row._id, keep: true });

    await generate(t);

    expect(await asUser.query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });

  it("rejects resolving another user's line (IDOR guard)", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("groceryList", {
        userId: "someone-else",
        item: "Parsley",
        canonicalItem: "parsley",
        unit: "tbsp",
        quantity: 2,
        aisle: "produce",
        checked: true,
        purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
      }),
    );

    await expect(
      t.withIdentity(identity).mutation(api.groceryList.resolveLeftover, { id, keep: true }),
    ).rejects.toThrow(/not found/i);
  });

  it("keeps another household's proposals out of the list", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.groceryList.mergeGroceryList, {
      userId: "someone-else",
      lines: [parsley],
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("groceryList").collect();
      await ctx.db.patch(rows[0]._id, { checked: true });
    });

    expect(await t.withIdentity(identity).query(api.groceryList.leftoverProposals, {})).toEqual([]);
  });
});

// BL-0019: a list that is never emptied stops being a list — the next trip
// starts buried under the last one's ticks.
describe("finishShopping", () => {
  const asRow = (item: string, checked: boolean, extra: Record<string, unknown> = {}) => ({
    userId: USER_ID,
    item,
    canonicalItem: item,
    unit: "",
    quantity: 1,
    aisle: "other",
    checked,
    ...extra,
  });

  async function seed(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", asRow("milk", true));
      await ctx.db.insert("groceryList", asRow("eggs", false));
      await ctx.db.insert("groceryList", asRow("kale", false));
    });
  }

  it("removes what was bought and keeps what was not", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const result = await t
      .withIdentity(identity)
      .mutation(api.groceryList.finishShopping, { unbought: "keep" });

    expect(result).toEqual({ purchased: 1, cleared: 0 });
    const rows = await t.withIdentity(identity).query(api.groceryList.getGroceryList, {});
    expect(rows.map((r) => r.item).sort()).toEqual(["eggs", "kale"]);
  });

  it("clears the unbought half too when the user asks it to", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const result = await t
      .withIdentity(identity)
      .mutation(api.groceryList.finishShopping, { unbought: "remove" });

    expect(result).toEqual({ purchased: 1, cleared: 2 });
    expect(await t.withIdentity(identity).query(api.groceryList.getGroceryList, {})).toEqual([]);
  });

  it("takes flagged lines with the bought half — that is the trip that just ended", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", asRow("kale", true, { removed: true }));
    });

    await t.withIdentity(identity).mutation(api.groceryList.finishShopping, { unbought: "keep" });

    expect(await t.withIdentity(identity).query(api.groceryList.getGroceryList, {})).toEqual([]);
  });

  it("leaves the pantry alone — check-off already recorded the inflow", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    const id = await t.run(async (ctx) => ctx.db.insert("groceryList", asRow("milk", false)));
    await asUser.mutation(api.groceryList.toggleItem, { id, checked: true });
    const before = await t.run(async (ctx) => ctx.db.query("pantryItems").collect());
    expect(before).toHaveLength(1);

    await asUser.mutation(api.groceryList.finishShopping, { unbought: "keep" });

    const after = await t.run(async (ctx) => ctx.db.query("pantryItems").collect());
    expect(after).toHaveLength(1);
    expect(after[0].canonicalItem).toBe("milk");
  });

  it("never reaches another household's list", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groceryList", { ...asRow("milk", true), userId: "someone-else" });
    });

    await t.withIdentity(identity).mutation(api.groceryList.finishShopping, { unbought: "remove" });

    const rows = await t.run(async (ctx) => ctx.db.query("groceryList").collect());
    expect(rows).toHaveLength(1);
  });
});

describe("restoreItem", () => {
  const manualLine = {
    item: "Foil",
    canonicalItem: "foil",
    unit: "",
    quantity: 1,
    aisle: "other",
    checked: false,
    manual: true,
  };

  it("puts a swiped-away manual line back", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.groceryList.restoreItem, { line: manualLine });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item: "Foil", manual: true, checked: false });
  });

  it("carries the line's own state back with it, not a fresh blank row", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.groceryList.restoreItem, {
      line: {
        ...manualLine,
        checked: true,
        quantity: 3,
        purchase: { quantity: 1, unit: "roll" },
        leftoverDecision: "kept" as const,
      },
    });

    const rows = await asUser.query(api.groceryList.getGroceryList, {});
    expect(rows[0]).toMatchObject({
      checked: true,
      quantity: 3,
      leftoverDecision: "kept",
      purchase: { quantity: 1, unit: "roll" },
    });
  });

  it("restores a dismissed flagged line", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.groceryList.restoreItem, {
      line: { ...manualLine, manual: undefined, checked: true, removed: true },
    });

    expect(await asUser.query(api.groceryList.getGroceryList, {})).toHaveLength(1);
  });

  it("cannot conjure a line that could never have been deleted", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t
        .withIdentity(identity)
        .mutation(api.groceryList.restoreItem, { line: { ...manualLine, manual: undefined } }),
    ).rejects.toThrow(/manually added or removed/i);
  });

  it("requires a signed-in user", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.groceryList.restoreItem, { line: manualLine })).rejects.toThrow(
      /not authenticated/i,
    );
  });
});
