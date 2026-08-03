import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { action, mutation, query } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

export const pantryStateValidator = v.union(v.literal("have"), v.literal("low"), v.literal("out"));

// --- helpers, shared with groceryList.toggleItem (not client-callable) ---

export const DAY_MS = 86_400_000;

/**
 * Approximate "use by" for an item entering the pantry now (BL-0029).
 * Returns undefined when the shelf life is unknown — an item recipe-service
 * doesn't recognize gets no date at all, because a guessed date is worse than
 * an absent one and would put junk into the "use this week" batch.
 */
export function useByFrom(shelfLifeDays: number | undefined, now: number): number | undefined {
  if (shelfLifeDays === undefined || shelfLifeDays <= 0) return undefined;
  return now + shelfLifeDays * DAY_MS;
}

/**
 * Record that the user owns `canonicalItem`. Idempotent: re-checking an item
 * refreshes it rather than duplicating. Never downgrades a hand-curated row to
 * `source: "auto"` — provenance, once manual, stays manual.
 *
 * Checking a line off is the purchase signal, so it also restarts the shelf-life
 * clock: buying spinach again pushes its `useBy` out, on a new row or an old one.
 */
export async function upsertFromCheckoff(
  ctx: MutationCtx,
  args: {
    userId: string;
    canonicalItem: string;
    display: string;
    aisle: string;
    shelfLifeDays?: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();

  const now = Date.now();
  const useBy = useByFrom(args.shelfLifeDays, now);

  if (existing === null) {
    await ctx.db.insert("pantryItems", {
      userId: args.userId,
      canonicalItem: args.canonicalItem,
      display: args.display,
      aisle: args.aisle,
      state: "have",
      source: "auto",
      updatedAt: now,
      useBy,
    });
    return;
  }
  // A patch with `useBy: undefined` clears a stale date rather than leaving a
  // date the current shelf-life data no longer supports.
  await ctx.db.patch(existing._id, { state: "have", updatedAt: now, useBy });
}

/**
 * Undo an auto-add when the user un-checks a line. Rows with
 * `source: "manual"` are left alone — a checkbox must never destroy curated data.
 *
 * Two grocery lines can share one `canonicalItem` (the Go aggregator keeps
 * non-convertible units as separate lines, e.g. "garlic, 2 cloves" and
 * "garlic, 10 grams"). If another checked line still claims this
 * canonicalItem, the user still owns it — deleting the pantry row here would
 * wrongly un-suppress the ingredient on the next grocery-list generation. So
 * before deleting we scan the user's other grocery lines for a surviving
 * checked claim.
 *
 * Ordering dependency: `toggleItem` in groceryList.ts patches the line's
 * `checked` field to false BEFORE calling this function, so the line being
 * un-checked is already absent from the "checked" set below and never counts
 * as its own survivor. If that ordering were ever reversed, this scan would
 * always see the un-checking line as still-checked and the pantry row would
 * never be deleted — do not reorder the patch and this call in toggleItem.
 */
export async function removeAutoRow(
  ctx: MutationCtx,
  args: { userId: string; canonicalItem: string },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();
  if (existing === null || existing.source !== "auto") return;

  const others = await ctx.db
    .query("groceryList")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .filter((q) => q.eq(q.field("checked"), true))
    .collect();
  const stillClaimed = others.some((line) => line.canonicalItem === args.canonicalItem);
  if (stillClaimed) return;

  await ctx.db.delete(existing._id);
}

// --- client-facing functions ---

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("pantryItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Sorted here (not in the UI) so aisle grouping is a simple consecutive
    // scan, matching how GroceryList groups.
    return rows.sort(
      (a, b) => a.aisle.localeCompare(b.aisle) || a.display.localeCompare(b.display),
    );
  },
});

export const setState = mutation({
  args: { id: v.id("pantryItems"), state: pantryStateValidator },
  handler: async (ctx, { id, state }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { state, updatedAt: Date.now() });
  },
});

/** What the "use these up → cook this" card needs. Deliberately not the whole recipe. */
export interface RecipeToUse {
  id: string;
  title: string;
  matchedItems: string[];
}

/**
 * Recipes that use the items about to expire — the action half of the batched
 * nudge (BL-0029). An expiry alert with nothing to do about it is the per-item
 * nag the design rules out, so this is what makes the card worth showing.
 *
 * An action, not a query, because only actions can reach recipe-service; the
 * ingredient→canonical matching has to happen there, where the normalization
 * table lives.
 */
export const recipesToUse = action({
  args: { items: v.array(v.string()), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { items, traceCtx }): Promise<RecipeToUse[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (items.length === 0) return [];
    return withSpan("pantry.recipesToUse", traceCtx, async (traceparent) => {
      const matches = await recipeServiceFetch<
        { id: string; title: string; matchedItems: string[] }[]
      >(userId, "POST", "/recipes/using", { items }, traceparent);
      // Narrowed to what the card renders: the full recipe bodies would be a
      // large payload for a prompt that only ever shows a title.
      return matches.map((m) => ({ id: m.id, title: m.title, matchedItems: m.matchedItems }));
    });
  },
});

export const remove = mutation({
  args: { id: v.id("pantryItems") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/**
 * Mark (or unmark) a pantry row as something to use up.
 *
 * This is a flag on the existing row rather than a separate "leftovers" table:
 * the row already carries the canonicalItem that joins to recipe ingredients,
 * so the recommender needs no second source of truth about what the user has.
 */
export const setUseItUp = mutation({
  args: { id: v.id("pantryItems"), useItUp: v.boolean() },
  handler: async (ctx, { id, useItUp }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(id);
    if (row === null || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { useItUp, updatedAt: Date.now() });
  },
});
