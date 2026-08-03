import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

export const pantryStateValidator = v.union(v.literal("have"), v.literal("low"), v.literal("out"));

// --- helpers, shared with groceryList.toggleItem (not client-callable) ---

/**
 * Record that the user owns `canonicalItem`. Idempotent: re-checking an item
 * refreshes it rather than duplicating. Never downgrades a hand-curated row to
 * `source: "auto"` — provenance, once manual, stays manual.
 */
export async function upsertFromCheckoff(
  ctx: MutationCtx,
  args: { userId: string; canonicalItem: string; display: string; aisle: string },
): Promise<void> {
  const existing = await ctx.db
    .query("pantryItems")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", args.userId).eq("canonicalItem", args.canonicalItem),
    )
    .unique();

  if (existing === null) {
    await ctx.db.insert("pantryItems", {
      userId: args.userId,
      canonicalItem: args.canonicalItem,
      display: args.display,
      aisle: args.aisle,
      state: "have",
      source: "auto",
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.patch(existing._id, { state: "have", updatedAt: Date.now() });
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
