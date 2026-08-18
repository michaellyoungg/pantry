import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { recipeServiceFetch } from "./recipes";

export const pantryStateValidator = v.union(v.literal("have"), v.literal("low"), v.literal("out"));

export type PantryState = Infer<typeof pantryStateValidator>;

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

/**
 * Flag a pantry item as something to use up, creating its row if the pantry has
 * none (BL-0032). Called when the user CONFIRMS an inferred leftover — never
 * from inference alone, which is the whole point of proposing rather than
 * asserting: a guessed row would silently un-suppress don't-rebuy.
 *
 * The row is normally already there, because checking the line off created it.
 * It is inserted rather than skipped when missing so the confirmation is never
 * a no-op the user cannot see the result of.
 *
 * `source` on an existing row is left alone for the same reason
 * `upsertFromCheckoff` leaves it: provenance, once manual, stays manual.
 */
export async function markUseItUp(
  ctx: MutationCtx,
  args: { userId: string; canonicalItem: string; display: string; aisle: string },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();
  const now = Date.now();
  if (existing === null) {
    await ctx.db.insert("pantryItems", {
      userId: args.userId,
      canonicalItem: args.canonicalItem,
      display: args.display,
      aisle: args.aisle,
      state: "have",
      source: "auto",
      useItUp: true,
      updatedAt: now,
    });
    return;
  }
  // Confirming a leftover is also a statement that the item is in the kitchen,
  // so a row stepped down by a cook-decrement comes back to "have".
  await ctx.db.patch(existing._id, { useItUp: true, state: "have", updatedAt: now });
}

// --- outflow: cook-decrement (BL-0028) ---

/**
 * One notch of outflow. Coarse on purpose: increment 1 models `have | low | out`
 * and never a quantity, because numeric inventory drifts from reality within
 * days. `out` is the floor — there is nothing below "you're out of it".
 */
export function steppedDown(state: PantryState): PantryState {
  return state === "have" ? "low" : "out";
}

/**
 * Step every pantry row a cooked recipe touched.
 *
 * Keyed on `canonicalItem` — the recipe-service normalization id the inflow loop
 * and the grocery list already use — so a cooked recipe decrements exactly the
 * rows check-off created. Keying on display text instead would match nothing and
 * fail silently, which is the failure mode that produced the empty-grocery-list
 * bug earlier in this repo.
 *
 * Two deliberate rules:
 *
 * - **Missing rows are not created.** An `out` row for every spice a recipe
 *   mentions would bury the pantry page under items the user never tracked;
 *   "absent" already reads as "not tracked" everywhere else in this loop.
 * - **`source` is ignored.** Cooking consumes food whoever entered it. That is
 *   the opposite of `removeAutoRow`, which must never touch a curated row —
 *   because un-checking a box is a bookkeeping correction, and this is a report
 *   of a physical event.
 */
export const applyCookDecrement = internalMutation({
  args: { userId: v.string(), canonicalItems: v.array(v.string()) },
  handler: async (ctx, { userId, canonicalItems }) => {
    const now = Date.now();
    // De-duplicated: a recipe can list the same ingredient on two lines (the Go
    // aggregator keeps non-convertible units apart), and one cook is one notch.
    for (const canonicalItem of new Set(canonicalItems)) {
      const row = await ctx.db
        .query("pantryItems")
        .withIndex("by_user_item", (q) => q.eq("userId", userId).eq("canonicalItem", canonicalItem))
        .unique();
      if (row === null) continue;
      const state = steppedDown(row.state);
      // Already `out`: skip the write entirely rather than churn updatedAt.
      if (state === row.state) continue;
      await ctx.db.patch(row._id, { state, updatedAt: now });
    }
  },
});

/**
 * Resolve a cooked recipe's normalized ingredients, then step them.
 *
 * An action because the ingredient → `canonicalItem` mapping lives in
 * recipe-service and only actions can reach it. `basket.markCooked` *schedules*
 * this rather than awaiting it, for two reasons:
 *
 * 1. A mutation physically cannot fetch.
 * 2. Recording that you cooked dinner should not fail because recipe-service is
 *    down. The plan record is the user's; the pantry step is a consequence of it.
 *
 * The cost is that a failed decrement is silent. It is recoverable through the
 * pantry page's manual have→low→out cycle — which is exactly why increment 1
 * made that escape hatch mandatory rather than polish.
 *
 * `POST /grocery-list` for one recipe at multiplier 1 is reused as the
 * ingredients → canonical-items endpoint rather than adding a Go route. Only the
 * keys are used; the quantities it returns are discarded, because the pantry
 * deliberately has none.
 */
export const cookDecrement = internalAction({
  args: { userId: v.string(), recipeId: v.string() },
  handler: async (ctx, { userId, recipeId }) => {
    const lines = await recipeServiceFetch<GroceryLine[]>(userId, "POST", "/grocery-list", {
      items: [{ recipeId, multiplier: 1 }],
    });
    const canonicalItems = [...new Set(lines.map((l) => l.canonicalItem).filter(Boolean))];
    if (canonicalItems.length === 0) return;
    await ctx.runMutation(internal.pantry.applyCookDecrement, { userId, canonicalItems });

    // Cooking a meal is the strongest taste signal the product has — an
    // intention that was actually carried out — and this is the ONE place that
    // already knows the recipe's normalized ingredients, which the affinity fold
    // needs and a mutation cannot fetch (BL-0005 increment 2). Recording it here
    // costs nothing; a `cooked` event of its own would repeat this exact HTTP
    // call to learn the same list.
    await ctx.runMutation(internal.recommendationEvents.recordCooked, {
      userId,
      recipeId,
      canonicalItems,
    });
  },
});

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

// `recipesToUse` lived here and is GONE (BL-0050). It answered "what can I cook
// with these before they go off" by calling POST /recipes/using, which applied
// no preference filtering — so the expiry card could suggest a recipe built on
// an ingredient the user had told us to avoid, on the same screen where the
// recommendations card was filtering that ingredient out.
//
// The expiry nudge now routes through `recommendations.pantry`, where the avoid
// list is a hard pre-filter and expiry is a scoring feature. There is one path,
// so the guarantee holds everywhere it is made.

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
