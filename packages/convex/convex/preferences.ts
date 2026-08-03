import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Household preferences. Today that is one number — how many people you cook
// for — which the planner uses to seed each recipe's servings dial (BL-0018).

// Somewhere between "just me" and a very large table. The ceiling isn't a
// guess at family sizes so much as a typo guard: 40 batches of everything is
// never what someone meant to ask the grocery list for.
const MAX_HOUSEHOLD_SIZE = 20;

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Always an object, never null: every caller wants "the household size,
    // possibly unset", and a null row would make each of them handle loading
    // and unset as two different shapes.
    return { householdSize: row?.householdSize };
  },
});

// Omitting householdSize clears it, which is a real choice rather than a no-op:
// "I'd rather not say" has to be reachable once it has been set, and it puts
// every recipe back on a single batch.
export const setHouseholdSize = mutation({
  args: { householdSize: v.optional(v.number()) },
  handler: async (ctx, { householdSize }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (householdSize !== undefined) {
      if (!Number.isInteger(householdSize) || householdSize < 1) {
        throw new Error("householdSize must be a whole number of people, at least 1");
      }
      if (householdSize > MAX_HOUSEHOLD_SIZE) {
        throw new Error(`householdSize must be at most ${MAX_HOUSEHOLD_SIZE}`);
      }
    }
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { householdSize });
    else await ctx.db.insert("preferences", { userId, householdSize });
  },
});
