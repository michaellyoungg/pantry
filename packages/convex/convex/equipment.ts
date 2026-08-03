import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  EquipmentCounts,
  EquipmentFit,
  EquipmentMatch,
  EquipmentMatchResult,
} from "@pantry/types";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

// The equipment inventory (BL-0043) — "My Kitchen".
//
// The split mirrors the grocery list: user state is reactive and lives here,
// the join against recipe data happens in recipe-service where that data is.
// Convex holds owned slugs and nothing else; it deliberately carries no copy of
// the equipment catalog (see recipes.listEquipment), so it cannot and does not
// validate a slug. The match endpoint ignores slugs it doesn't recognise, which
// is what keeps a retired catalog entry from breaking the whole screen.

/** What the catalog needs: a fit per recipe id, plus honest bucket totals. */
export interface MakeabilityResult {
  fits: Record<string, EquipmentFit>;
  counts: EquipmentCounts;
}

/**
 * The user's owned slugs. Internal because actions need it and actions cannot
 * read the database directly; the client uses `list`, which carries the row
 * metadata the UI wants.
 */
export const ownedSlugs = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string[]> => {
    const rows = await ctx.db
      .query("equipmentInventory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.equipmentId);
  },
});

/**
 * Everything the user owns, most recently acquired first — the order the
 * "new to your kitchen" prompt reads, and a reasonable one for the list too.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("equipmentInventory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  },
});

/**
 * Check or un-check one piece of equipment. Idempotent in both directions: the
 * UI is a set of checkboxes, and a double-tap or a replayed optimistic update
 * must not create a second row or throw.
 *
 * Owning something is a row; not owning it is the absence of one. Storing
 * `owned: false` would invent a third state ("explicitly disowned") that no
 * caller can distinguish from "never said", and the match logic has no use for
 * it.
 *
 * Re-checking something already owned leaves `addedAt` alone rather than
 * refreshing it — the acquisition date is what "new to your kitchen" means, and
 * a stray toggle should not resurface a two-year-old blender as news.
 */
export const setOwned = mutation({
  args: { equipmentId: v.string(), owned: v.boolean() },
  handler: async (ctx, { equipmentId, owned }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("equipmentInventory")
      .withIndex("by_user_equipment", (q) => q.eq("userId", userId).eq("equipmentId", equipmentId))
      .unique();

    if (owned) {
      if (existing !== null) return;
      await ctx.db.insert("equipmentInventory", { userId, equipmentId, addedAt: Date.now() });
      return;
    }
    if (existing !== null) await ctx.db.delete(existing._id);
  },
});

/**
 * Classify every recipe the user can see against what they own.
 *
 * Returns a map keyed by recipe id rather than whole recipes: the catalog has
 * already loaded the recipes it renders, and shipping second copies of them to
 * the browser just to attach a status would double the payload for no gain.
 *
 * `counts` covers every recipe recipe-service considered — the user's own plus
 * the shared catalog — so a screen showing only the catalog should present its
 * own filtered totals rather than these. What it must not do is drop `unknown`
 * from what it tells the user.
 */
export const makeability = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<MakeabilityResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("equipment.makeability", traceCtx, async (traceparent) => {
      const owned = await ctx.runQuery(internal.equipment.ownedSlugs, { userId });
      const result = await recipeServiceFetch<EquipmentMatchResult>(
        userId,
        "POST",
        "/equipment/match",
        { owned },
        traceparent,
      );
      const fits: Record<string, EquipmentFit> = {};
      for (const m of result.recipes) {
        fits[m.id] = { status: m.status, missing: m.missing, unlockedBy: m.unlockedBy };
      }
      return { fits, counts: result.counts };
    });
  },
});

/**
 * "I just got a panini press — what can I make?"
 *
 * The headline of BL-0043. Answered against the current inventory with the one
 * device singled out, so recipes that were already possible are excluded: being
 * told you can now make the roast chicken you have always been able to make is
 * not a discovery. Whole recipes here, not a fit map, because this list has no
 * recipes on screen to join onto.
 *
 * Passing an id the user does not own returns nothing rather than an error: the
 * inventory is reactive, so an un-check racing this call is normal.
 */
export const unlockedBy = action({
  args: { equipmentId: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { equipmentId, traceCtx }): Promise<EquipmentMatch[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("equipment.unlockedBy", traceCtx, async (traceparent) => {
      const owned = await ctx.runQuery(internal.equipment.ownedSlugs, { userId });
      if (!owned.includes(equipmentId)) return [];
      const result = await recipeServiceFetch<EquipmentMatchResult>(
        userId,
        "POST",
        "/equipment/match",
        { owned, acquired: [equipmentId] },
        traceparent,
      );
      return result.recipes;
    });
  },
});
