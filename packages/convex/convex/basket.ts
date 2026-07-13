import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

// Adds a new unscheduled meal entry. No dedupe — a recipe can be planned more
// than once (e.g. the same dish on two days).
export const add = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db.insert("basket", {
      userId,
      recipeId,
      title,
      servingsMultiplier: 1,
      type: "meal",
    });
  },
});

export const removeEntry = mutation({
  args: { id: v.id("basket") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

export const assignDay = mutation({
  args: { id: v.id("basket"), plannedDate: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, plannedDate }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { plannedDate: plannedDate ?? undefined });
  },
});

export const setServings = mutation({
  args: { id: v.id("basket"), servingsMultiplier: v.number() },
  handler: async (ctx, { id, servingsMultiplier }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { servingsMultiplier: Math.max(0.25, servingsMultiplier) });
  },
});

export const setType = mutation({
  args: { id: v.id("basket"), type: v.union(v.literal("meal"), v.literal("leftover")) },
  handler: async (ctx, { id, type }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { type });
  },
});

// Recipe-delete cleanup: remove ALL entries for a recipe.
export const remove = mutation({
  args: { recipeId: v.string() },
  handler: async (ctx, { recipeId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

// Recipe-rename: update the denormalized title on ALL entries for a recipe.
export const updateTitle = mutation({
  args: { recipeId: v.string(), title: v.string() },
  handler: async (ctx, { recipeId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .collect();
    for (const row of rows) await ctx.db.patch(row._id, { title });
  },
});
