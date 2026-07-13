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

// Schedule a basketed recipe onto a weekday (BL-0018). weekday is 0=Mon..6=Sun.
// slot defaults to "dinner" — the only slot in the dinner-first v1. Idempotent
// no-op if the recipe isn't in the basket.
export const schedule = mutation({
  args: { recipeId: v.string(), weekday: v.number(), slot: v.optional(v.string()) },
  handler: async (ctx, { recipeId, weekday, slot }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error("weekday must be an integer 0..6");
    }
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { weekday, slot: slot ?? "dinner" });
  },
});

// Move a recipe back to the unscheduled rail (clears its day/slot) without
// removing it from the basket. Idempotent no-op if the recipe isn't basketed.
export const unschedule = mutation({
  args: { recipeId: v.string() },
  handler: async (ctx, { recipeId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { weekday: undefined, slot: undefined });
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

// Servings multiplier applied to this recipe's ingredient quantities when the
// grocery list is generated (BL-0018 increment 2). Clamped to >= 0.25.
export const setServings = mutation({
  args: { recipeId: v.string(), servingsMultiplier: v.number() },
  handler: async (ctx, { recipeId, servingsMultiplier }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        servingsMultiplier: Math.max(0.25, servingsMultiplier),
      });
    }
  },
});

// Marks a planned recipe as a leftover (occupies its day but adds nothing to
// the grocery list) or back to a meal.
export const setType = mutation({
  args: { recipeId: v.string(), type: v.union(v.literal("meal"), v.literal("leftover")) },
  handler: async (ctx, { recipeId, type }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("basket")
      .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { type });
  },
});
