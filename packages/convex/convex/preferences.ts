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

// Somewhere between "just me" and a very large table. The ceiling isn't a guess
// at family sizes so much as a typo guard: 40 batches of everything is never
// what someone meant to ask the grocery list for.
const MAX_HOUSEHOLD_SIZE = 20;

/**
 * Household size, written on its own (BL-0018).
 *
 * Separate from `set` above for two reasons. `set` deliberately preserves
 * fields the caller omits, so it has no way to express "clear this" — and
 * "I'd rather not say" has to stay reachable once a size has been set, since it
 * is what puts every recipe back on a single batch. And a household size is the
 * one preference here that is arithmetic rather than a list of words: it
 * divides into every scaled grocery quantity, so a fractional or zero value has
 * to be refused at the edge rather than quietly multiplied through.
 */
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
    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { householdSize, updatedAt: Date.now() });
      return;
    }
    // First thing this user has ever set. The list fields are non-optional on
    // the table, so a row has to be born complete rather than half-formed.
    await ctx.db.insert("preferences", {
      userId,
      avoidItems: [],
      likedItems: [],
      dislikedItems: [],
      householdSize,
      updatedAt: Date.now(),
    });
  },
});
