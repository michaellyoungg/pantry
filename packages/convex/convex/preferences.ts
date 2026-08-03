import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Normalizes stored ingredient keys to lowercased, trimmed, de-duplicated
 * strings. This is NOT Go's CanonicalItem: Go's Normalizer also resolves a
 * 44-entry synonym table and folds plurals (see
 * apps/recipe-service/internal/recipe/normalization.json), so "beef" here
 * never matches "ground beef" and "peanut" never matches "peanut butter".
 *
 * `containsAvoided` in the recommend package does an EXACT map lookup
 * against each ingredient's already-canonicalized key, so an avoid-list
 * entry only removes recipes whose ingredient text canonicalizes to that
 * exact string. Free-typed entries and diet-seed lists must therefore use
 * real canonical item keys, not merely lowercased words, or they silently
 * filter nothing. Full synonym-aware canonicalization of free-typed entries
 * is a follow-up (needs a Convex action + its own UX), not done here.
 */
const canonicalize = (items: string[] | undefined): string[] =>
  Array.from(new Set((items ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)));

const EMPTY = {
  avoidItems: [] as string[],
  likedItems: [] as string[],
  dislikedItems: [] as string[],
  dietLabels: [] as string[],
  cuisines: [] as string[],
  maxMinutes: undefined as number | undefined,
  householdSize: undefined as number | undefined,
};

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Absent preferences are not an error — a user who has never opened
    // settings still gets recommendations, just without preference signal.
    if (row === null) return EMPTY;
    return {
      avoidItems: row.avoidItems,
      likedItems: row.likedItems,
      dislikedItems: row.dislikedItems,
      dietLabels: row.dietLabels ?? [],
      cuisines: row.cuisines ?? [],
      maxMinutes: row.maxMinutes,
      householdSize: row.householdSize,
    };
  },
});

export const set = mutation({
  args: {
    avoidItems: v.optional(v.array(v.string())),
    likedItems: v.optional(v.array(v.string())),
    dislikedItems: v.optional(v.array(v.string())),
    dietLabels: v.optional(v.array(v.string())),
    cuisines: v.optional(v.array(v.string())),
    maxMinutes: v.optional(v.number()),
    householdSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const next = {
      userId,
      avoidItems: canonicalize(args.avoidItems ?? existing?.avoidItems),
      likedItems: canonicalize(args.likedItems ?? existing?.likedItems),
      dislikedItems: canonicalize(args.dislikedItems ?? existing?.dislikedItems),
      dietLabels: args.dietLabels ?? existing?.dietLabels,
      cuisines: args.cuisines ?? existing?.cuisines,
      maxMinutes: args.maxMinutes ?? existing?.maxMinutes,
      householdSize: args.householdSize ?? existing?.householdSize,
      updatedAt: Date.now(),
    };

    if (existing === null) await ctx.db.insert("preferences", next);
    else await ctx.db.patch(existing._id, next);
  },
});
