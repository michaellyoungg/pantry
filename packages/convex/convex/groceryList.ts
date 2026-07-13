import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

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

// Returns rows in insertion order (recipe-service pre-sorts lines by aisle
// before they're persisted). The web GroceryList relies on this ordering to
// group consecutive same-aisle lines under one header — do not add .order()
// here without updating that grouping.
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
        aisle: line.aisle,
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

// "Done shopping — remove purchased" (BL-0019): drop the checked (in-cart) rows
// and keep the unbought ones for the next trip. Distinct from clearGroceryList,
// which wipes everything regardless of checked state.
export const removeChecked = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) {
      if (row.checked) await ctx.db.delete(row._id);
    }
  },
});
