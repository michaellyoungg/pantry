import { getAuthUserId } from "@convex-dev/auth/server";
import type { NutritionEstimate } from "@pantry/types";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { recipeServiceFetch } from "./recipes";

// The plan nutrition rollup (BL-0037). One estimate per planned day plus one for
// the whole week, fanned out from the basket the planner already maintains.
//
// The week is a separate call rather than the sum of the days on purpose: its
// coverage is then computed over the whole week's food in one pass, and a
// coverage fraction is a ratio — averaging seven of them is not the ratio of the
// sums. The days and the week must agree, so both are asked the same way.

/** A basket row as the rollup reads it. */
interface PlannedEntry {
  recipeId: string;
  title: string;
  weekday?: number;
  servingsMultiplier?: number;
  type?: string;
}

/** One request item, the same shape POST /grocery-list already accepts. */
interface RollupItem {
  recipeId: string;
  multiplier: number;
}

export interface PlanDayNutrition {
  weekday: number;
  estimate: NutritionEstimate;
}

/**
 * Structurally identical to `PlanNutrition` in @pantry/core, which consumes it.
 * It cannot import that type: @pantry/core depends on @pantry/convex, so the
 * arrow only points one way. The web app passes this value straight into
 * `rollUpWeekNutrition`, so the compiler checks the two agree at that call site.
 */
export interface PlanNutritionResult {
  days: PlanDayNutrition[];
  week: NutritionEstimate | null;
}

/**
 * Leftovers count here, and only here.
 *
 * The grocery list excludes them because they are already cooked — nothing to
 * buy. Nutrition is the exact inverse: a leftover is food that gets eaten, so
 * omitting it would under-report every day that lives off Sunday's roast. The
 * basket holds one row per recipe, so a dish is either a meal or a leftover and
 * can never be counted twice.
 */
function rollupItems(entries: PlannedEntry[]): RollupItem[] {
  return entries.map((e) => ({
    recipeId: e.recipeId,
    multiplier: e.servingsMultiplier ?? 1,
  }));
}

/**
 * Fills in the title of a recipe the service could not read back.
 *
 * recipe-service returns no title for an uncounted recipe — it never loaded one,
 * and an unreadable recipe should leak nothing. The basket remembers it, so
 * "Chili could not be counted" beats "a removed recipe could not be counted"
 * without the service having to tell us about a row it cannot see.
 */
function nameUncountedRecipes(
  estimate: NutritionEstimate,
  titles: Map<string, string>,
): NutritionEstimate {
  if (!estimate.recipes?.some((r) => !r.counted && !r.title)) return estimate;
  return {
    ...estimate,
    recipes: estimate.recipes.map((r) =>
      r.counted || r.title ? r : { ...r, title: titles.get(r.recipeId) ?? "" },
    ),
  };
}

export const planNutrition = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<PlanNutritionResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    return withSpan("nutrition.planNutrition", traceCtx, async (traceparent) => {
      const basket: PlannedEntry[] = await ctx.runQuery(api.basket.list, {});
      const titles = new Map(basket.map((b) => [b.recipeId, b.title]));

      // Only scheduled entries have a day to belong to; the unscheduled rail is
      // a shopping-basket concept, not a week of eating.
      const scheduled = basket.filter((b): b is PlannedEntry & { weekday: number } =>
        Number.isInteger(b.weekday),
      );
      if (scheduled.length === 0) return { days: [], week: null };

      const byDay = new Map<number, PlannedEntry[]>();
      for (const entry of scheduled) {
        const day = byDay.get(entry.weekday) ?? [];
        day.push(entry);
        byDay.set(entry.weekday, day);
      }

      const estimate = (items: RollupItem[]) =>
        recipeServiceFetch<NutritionEstimate>(
          userId,
          "POST",
          "/nutrition/estimate",
          { items },
          traceparent,
        );

      const weekdays = [...byDay.keys()].sort((a, b) => a - b);
      const [week, ...dayEstimates] = await Promise.all([
        estimate(rollupItems(scheduled)),
        ...weekdays.map((d) => estimate(rollupItems(byDay.get(d) ?? []))),
      ]);

      return {
        days: weekdays.map((weekday, i) => ({
          weekday,
          estimate: nameUncountedRecipes(dayEstimates[i], titles),
        })),
        week: nameUncountedRecipes(week, titles),
      };
    });
  },
});
