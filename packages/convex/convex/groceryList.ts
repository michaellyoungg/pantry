import { query, mutation, internalMutation } from "./_generated/server";
import { v, type Infer } from "convex/values";
import type { GroceryLine } from "@pantry/types";
import { getAuthUserId } from "@convex-dev/auth/server";

// Single runtime source for the grocery-line shape on the Convex side. Its
// inferred type is pinned to the @pantry/types contract by the guard below, so
// the validator and the shared TS type can't silently drift.
export const groceryLineValidator = v.object({
  item: v.string(),
  unit: v.string(),
  quantity: v.number(),
});

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if groceryLineValidator and @pantry/types GroceryLine drift.
export const _groceryLineInSync: Equals<Infer<typeof groceryLineValidator>, GroceryLine> = true;

export const getGroceryList = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Called only from the generateGroceryList action, which passes the
// authenticated userId it already resolved. Internal → not client-callable.
export const replaceGroceryList = internalMutation({
  args: {
    userId: v.string(),
    lines: v.array(groceryLineValidator),
  },
  handler: async (ctx, { userId, lines }) => {
    const existing = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const line of lines) {
      await ctx.db.insert("groceryList", {
        userId,
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
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { checked });
  },
});

export const clearGroceryList = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
