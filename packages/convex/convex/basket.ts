import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEV_USER_ID } from "./constants";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("basket")
      .withIndex("by_user", (q) => q.eq("userId", DEV_USER_ID))
      .collect();
  },
});

export const add = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) =>
        q.eq("userId", DEV_USER_ID).eq("recipeId", recipeId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("basket", { userId: DEV_USER_ID, recipeId, title });
  },
});

export const remove = mutation({
  args: { recipeId: v.string() },
  handler: async (ctx, { recipeId }) => {
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) =>
        q.eq("userId", DEV_USER_ID).eq("recipeId", recipeId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) =>
        q.eq("userId", DEV_USER_ID).eq("recipeId", recipeId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, { title });
  },
});
