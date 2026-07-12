import { query, mutation, internalMutation } from "./_generated/server";
import { v, type Infer } from "convex/values";
import type { GroceryLine } from "@pantry/types";
import { DEV_USER_ID } from "./constants";

// Single runtime source for the grocery-line shape on the Convex side. Its
// inferred type is pinned to the @pantry/types contract by the guard below, so
// the validator and the shared TS type can't silently drift.
export const groceryLineValidator = v.object({
  item: v.string(),
  unit: v.string(),
  quantity: v.number(),
  aisle: v.string(),
});

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if groceryLineValidator and @pantry/types GroceryLine drift.
export const _groceryLineInSync: Equals<Infer<typeof groceryLineValidator>, GroceryLine> = true;

export const getGroceryList = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", DEV_USER_ID))
      .collect();
  },
});

export const replaceGroceryList = internalMutation({
  args: {
    lines: v.array(groceryLineValidator),
  },
  handler: async (ctx, { lines }) => {
    const existing = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", DEV_USER_ID))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const line of lines) {
      await ctx.db.insert("groceryList", {
        userId: DEV_USER_ID,
        item: line.item,
        unit: line.unit,
        quantity: line.quantity,
        aisle: line.aisle,
        checked: false,
      });
    }
  },
});

export const toggleItem = mutation({
  args: { id: v.id("groceryList"), checked: v.boolean() },
  handler: async (ctx, { id, checked }) => {
    await ctx.db.patch(id, { checked });
  },
});

export const clearGroceryList = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", DEV_USER_ID))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
