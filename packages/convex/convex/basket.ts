import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db
      .query("basket")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const add = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("basket", { userId, recipeId, title });
  },
});

export const remove = mutation({
  args: { recipeId: v.string() },
  handler: async (ctx, { recipeId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { title });
  },
});
