import { getAuthUserId } from "@convex-dev/auth/server";
import type { CostEstimate, GroceryLine } from "@pantry/types";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

/**
 * Grocery pricing (BL-0023 increment 1).
 *
 * Pricing is a separate seam, not a field on the grocery list: it has its own
 * data source, refresh cadence and legal constraints. Nothing here writes, and
 * `schema.ts` is untouched — an estimate is a pure function of (lines,
 * snapshot), so caching it in a table would buy one avoided round trip in
 * exchange for invalidating on every list edit, check-off and regeneration.
 */

/** The subset of a grocery line recipe-service needs to price it. */
type PricingLine = Pick<GroceryLine, "canonicalItem" | "item" | "unit" | "quantity">;

async function estimate(userId: string, lines: PricingLine[], traceparent?: string) {
  return recipeServiceFetch<CostEstimate>(
    userId,
    "POST",
    "/pricing/estimate",
    { lines },
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
      return estimate(userId, lines, traceparent);
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
      return estimate(userId, lines, traceparent);
    });
  },
});
