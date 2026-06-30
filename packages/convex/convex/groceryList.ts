import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { DEV_USER_ID } from "./constants";

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
    lines: v.array(
      v.object({ item: v.string(), unit: v.string(), quantity: v.number() }),
    ),
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
