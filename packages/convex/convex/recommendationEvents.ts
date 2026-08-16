import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type QueryCtx } from "./_generated/server";
import { type DerivedSignal, deriveSignal, type FoldableEvent } from "./lib/affinity";

/**
 * The recommendation interaction log (BL-0005 increment 2).
 *
 * Convex owns this table outright. recipe-service never sees it: the
 * recommendation actions fold a recent window into an ingredient-weight map and
 * send THAT in the request body, which is what keeps the ranker stateless and
 * keeps derivation in the one place that owns the history it derives from.
 *
 * Writes come from three places, and it is worth being explicit about which,
 * because a log nobody writes to is the most convincing kind of dead feature:
 *
 *  - the recommendation surfaces, for `shown` / `accepted` / `dismissed`;
 *  - `pantry.cookDecrement`, for `cooked` — the one place that already knows a
 *    cooked recipe's normalized ingredients;
 *  - nothing else. In particular, adding a recipe from the catalog page is not
 *    an interaction with a recommendation, and counting it would teach the
 *    recommender about a screen it had no part in.
 */

const validAction = v.union(
  v.literal("shown"),
  v.literal("accepted"),
  v.literal("dismissed"),
  v.literal("cooked"),
);
const validContext = v.union(v.literal("pantry"), v.literal("discover"));

/**
 * How far back the fold reads.
 *
 * Comfortably past the 30-day affinity half-life, where a signal is worth an
 * eighth of a fresh one — far enough that the window edge cannot cause a visible
 * jump, close enough that the query stays a bounded read.
 */
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * A hard ceiling on rows read per request, independent of the window.
 *
 * A recommendation call must not get slower the longer someone has used the
 * product. Newest-first, so what gets dropped is the oldest and most decayed —
 * the rows that were already worth the least.
 */
const MAX_EVENTS = 500;

/**
 * How long a recipe stays "already shown" for impression de-duplication.
 *
 * Without this, every render of a recommendation surface writes a row per card,
 * and the impression rows bury the intentional ones by orders of magnitude —
 * exactly the failure that made the design reject impression logging outright.
 * A day is the granularity `novelty` actually needs: the question it answers is
 * "have I offered you this before", not "how many times did React re-render".
 */
const SHOWN_DEDUPE_MS = 24 * 60 * 60 * 1000;

/**
 * How many of a recipe's recent rows the impression check looks at.
 *
 * The index is keyed by (user, recipe) and not by action, so a recent `shown`
 * can sit behind a handful of newer rows for the same recipe. A small fixed scan
 * covers that without turning a write into an unbounded read; the worst case if
 * it misses is one duplicate impression row, which costs nothing — `novelty`
 * reads counts, and an off-by-one there cannot change an ordering.
 */
const MAX_SHOWN_SCAN = 8;

/** Whether this recipe already has an impression inside the dedupe window. */
async function shownRecently(
  ctx: QueryCtx,
  userId: string,
  recipeId: string,
  now: number,
): Promise<boolean> {
  const recent = await ctx.db
    .query("recommendationEvents")
    .withIndex("by_user_recipe", (q) => q.eq("userId", userId).eq("recipeId", recipeId))
    .order("desc")
    .take(MAX_SHOWN_SCAN);
  return recent.some((e) => e.action === "shown" && now - e.createdAt < SHOWN_DEDUPE_MS);
}

/** Read the recent window for one user, newest first. */
async function recentEvents(ctx: QueryCtx, userId: string, now: number): Promise<FoldableEvent[]> {
  const rows = await ctx.db
    .query("recommendationEvents")
    .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("createdAt", now - WINDOW_MS))
    .order("desc")
    .take(MAX_EVENTS);
  return rows.map((row) => ({
    recipeId: row.recipeId,
    action: row.action,
    canonicalItems: row.canonicalItems,
    createdAt: row.createdAt,
  }));
}

/**
 * The derived taste signal for one user, as the ranker receives it.
 *
 * Internal because it takes an explicit `userId`: it is called from the
 * recommendation actions, which have already resolved the caller's identity, and
 * exposing it publicly would be a second, weaker authorization path to the same
 * data.
 */
export const signalFor = internalQuery({
  args: { userId: v.string(), now: v.number() },
  handler: async (ctx, { userId, now }): Promise<DerivedSignal> =>
    deriveSignal(await recentEvents(ctx, userId, now), now),
});

/**
 * Record one interaction.
 *
 * `canonicalItems` is passed by the CLIENT because the client already has it:
 * every recommendation carries the recipe's canonical ingredients in `have` and
 * `missing`. A mutation cannot fetch, so the alternative would be an action
 * round-trip to recipe-service per click, to re-derive something already on
 * screen.
 *
 * The recipe id is not validated against anything. It names a row in
 * recipe-service, which Convex deliberately keeps no copy of — the same
 * arrangement `basket` and `equipmentInventory` already live with. An event for
 * a recipe that later disappears simply stops matching any candidate.
 */
export const record = mutation({
  args: {
    recipeId: v.string(),
    context: validContext,
    action: validAction,
    canonicalItems: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { recipeId, context, action, canonicalItems }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const now = Date.now();

    // Impressions are deduplicated; deliberate actions never are. Dismissing the
    // same recipe twice is two statements, and the second one is the user
    // telling us the first did not take.
    if (action === "shown" && (await shownRecently(ctx, userId, recipeId, now))) return;

    await ctx.db.insert("recommendationEvents", {
      userId,
      recipeId,
      context,
      action,
      canonicalItems,
      createdAt: now,
    });
  },
});

/**
 * Record a cook, from `pantry.cookDecrement`.
 *
 * Internal and userId-carrying because it is called from a scheduled action, on
 * nobody's behalf in the request sense — the same shape as
 * `pantry.applyCookDecrement` beside it.
 *
 * `context: "pantry"` is honest rather than precise: we know the meal was
 * cooked, not which surface originally suggested it, and inventing a `discover`
 * attribution to make a funnel look complete would be worse than the imprecision.
 */
export const recordCooked = internalMutation({
  args: {
    userId: v.string(),
    recipeId: v.string(),
    canonicalItems: v.array(v.string()),
  },
  handler: async (ctx, { userId, recipeId, canonicalItems }) => {
    await ctx.db.insert("recommendationEvents", {
      userId,
      recipeId,
      context: "pantry",
      action: "cooked",
      canonicalItems,
      createdAt: Date.now(),
    });
  },
});

/**
 * Record impressions for a whole rendered batch in one mutation.
 *
 * One call per card would be twenty mutations per page view; batching keeps a
 * render to a single write transaction. De-duplication still runs per recipe
 * inside it.
 */
export const recordShownBatch = mutation({
  args: {
    context: validContext,
    recipes: v.array(v.object({ recipeId: v.string(), canonicalItems: v.array(v.string()) })),
  },
  handler: async (ctx, { context, recipes }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const now = Date.now();

    for (const { recipeId, canonicalItems } of recipes) {
      if (await shownRecently(ctx, userId, recipeId, now)) continue;

      await ctx.db.insert("recommendationEvents", {
        userId,
        recipeId,
        context,
        action: "shown",
        canonicalItems,
        createdAt: now,
      });
    }
  },
});
