import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  CostEstimate,
  GroceryLine,
  PricingLine,
  StoreProviderStatus,
  StoreSearchResult,
} from "@pantry/types";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { action, mutation, query } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

/**
 * Grocery pricing (BL-0023 increment 1).
 *
 * Pricing is a separate seam, not a field on the grocery list: it has its own
 * data source, refresh cadence and legal constraints. The estimate itself is
 * still never cached — it is a pure function of (lines, snapshot, store), so a
 * table would buy one avoided round trip in exchange for invalidating on every
 * list edit, check-off and regeneration.
 *
 * The one thing that IS stored is the store a user opted into for real shelf
 * prices (BL-0046). That is a user decision, not a derived value, and no store
 * is the default — which is why nothing here changes for anyone who never
 * picks one.
 */

/** The store a user opted into, or null. */
async function storeFor(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("storeSelection")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function estimate(
  userId: string,
  lines: PricingLine[],
  store: { provider: string; locationId: string } | null,
  traceparent?: string,
) {
  return recipeServiceFetch<CostEstimate>(
    userId,
    "POST",
    "/pricing/estimate",
    {
      lines,
      // Absent for every user who has not opted in. recipe-service ignores both
      // when the feature is off, so a stale selection is inert rather than an
      // error.
      storeLocationId: store?.locationId,
      storeProvider: store?.provider,
    },
    traceparent,
  );
}

/**
 * Estimated cost of the user's current grocery list.
 *
 * Lines flagged `alreadyHave` are excluded: the pantry says the user owns them,
 * so they are not part of this shop's bill. Checked-off lines stay in — they are
 * in the cart, not off the list.
 */
export const estimateGroceryList = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<CostEstimate> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("pricing.estimateGroceryList", traceCtx, async (traceparent) => {
      const rows = await ctx.runQuery(api.groceryList.getGroceryList, {});
      const lines = rows
        .filter((r: { alreadyHave?: boolean }) => !r.alreadyHave)
        .map((r: { canonicalItem?: string; item: string; unit: string; quantity: number }) => ({
          // Rows predating BL-0021 have no canonical key; the display text is
          // the only identity available and recipe-service falls back to it.
          canonicalItem: r.canonicalItem ?? "",
          item: r.item,
          unit: r.unit,
          quantity: r.quantity,
        }));
      return estimate(userId, lines, await ctx.runQuery(api.pricing.getStore, {}), traceparent);
    });
  },
});

/**
 * Estimated cost of a single recipe, for a plan card.
 *
 * It aggregates through the same `/grocery-list` endpoint the weekly list uses
 * before pricing, so per-recipe cost cannot drift from the list total by using
 * a parallel aggregation path.
 */
export const estimateRecipe = action({
  args: {
    recipeId: v.string(),
    multiplier: v.optional(v.number()),
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { recipeId, multiplier, traceCtx }): Promise<CostEstimate> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("pricing.estimateRecipe", traceCtx, async (traceparent) => {
      const lines = await recipeServiceFetch<GroceryLine[]>(
        userId,
        "POST",
        "/grocery-list",
        { items: [{ recipeId, multiplier: multiplier ?? 1 }] },
        traceparent,
      );
      return estimate(userId, lines, await ctx.runQuery(api.pricing.getStore, {}), traceparent);
    });
  },
});

/**
 * Real store prices (BL-0046).
 *
 * Three things gate a shelf price, and any of them missing leaves the BLS
 * estimate exactly as it is today: the deployment's feature flag, the
 * provider's credentials, and this user having chosen a store. Only the third
 * lives here.
 */

/**
 * The store this user opted into, or null.
 *
 * A query rather than a field on the estimate so it is reactive: choosing a
 * store re-runs the estimate through the same subscription that renders it,
 * with no manual refresh and no stale total.
 */
export const getStore = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await storeFor(ctx, userId);
    if (row === null) return null;
    return {
      provider: row.provider,
      locationId: row.locationId,
      name: row.name,
      address: row.address,
    };
  },
});

/**
 * Whether this deployment can price against a real store at all, so the UI can
 * hide the chooser rather than offer a control that cannot work. It is the
 * server's feature flag, read through the service rather than duplicated here.
 */
export const storeProvider = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<StoreProviderStatus> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("pricing.storeProvider", traceCtx, async (traceparent) =>
      recipeServiceFetch<StoreProviderStatus>(
        userId,
        "GET",
        "/pricing/store-provider",
        undefined,
        traceparent,
      ),
    );
  },
});

/** Stores near a zip code, for the chooser. Empty when the feature is off. */
export const searchStores = action({
  args: {
    zipCode: v.string(),
    radiusMiles: v.optional(v.number()),
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { zipCode, radiusMiles, traceCtx }): Promise<StoreSearchResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("pricing.searchStores", traceCtx, async (traceparent) =>
      recipeServiceFetch<StoreSearchResult>(
        userId,
        "POST",
        "/pricing/stores",
        { zipCode, radiusMiles },
        traceparent,
      ),
    );
  },
});

/**
 * Opt in to a store. One row per user: choosing again replaces the choice
 * rather than accumulating stores nobody shops at.
 */
export const selectStore = mutation({
  args: {
    provider: v.string(),
    locationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await storeFor(ctx, userId);
    const row = { userId, ...args, updatedAt: Date.now() };
    if (existing === null) {
      await ctx.db.insert("storeSelection", row);
      return;
    }
    await ctx.db.patch(existing._id, row);
  },
});

/** Opt back out. The next estimate is the BLS one, with no other side effect. */
export const clearStore = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await storeFor(ctx, userId);
    if (existing !== null) await ctx.db.delete(existing._id);
  },
});
