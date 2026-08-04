import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  Recommendation,
  RecommendationNutritionTarget,
  RecommendationPlanNutrition,
  RecommendationPreferences,
  RecommendationRequest,
  RecommendationResponse,
} from "@pantry/types";
import { api } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import type { PlanNutritionResult } from "./nutrition";

// How long we wait on recipe-service before giving up. Recommendations are
// additive — a slow ranker must never hang the Pantry page.
const TIMEOUT_MS = 5_000;

/**
 * What the week's plan already commits, for the set-level half of BL-0040.
 *
 * It reuses `nutrition.planNutrition` rather than summing the basket itself so
 * the number the recommender scores against is the SAME number the planner puts
 * on screen. Two ways of totalling a week would drift, and the user would have
 * no way to tell which one was lying.
 *
 * Returns null unless a `week` goal actually needs it: the rollup is a fan-out
 * of HTTP calls, and a user with only per-meal goals should not pay for one.
 */
async function committedWeek(
  ctx: ActionCtx,
  targets: RecommendationNutritionTarget[],
): Promise<RecommendationPlanNutrition | null> {
  if (!targets.some((t) => t.period === "week")) return null;

  const plan: PlanNutritionResult = await ctx.runAction(api.nutrition.planNutrition, {});
  const week = plan.week;
  if (!week) return null;

  // The wire type carries `{amount, unit}` per nutrient; the scorer wants bare
  // numbers in the estimate's own units, which are the units the targets are
  // written in (both are keyed by FDC nutrient number).
  const nutrients: Record<string, number> = {};
  for (const [nutrientId, amount] of Object.entries(week.nutrients)) {
    nutrients[nutrientId] = amount.amount;
  }
  return { nutrients, coverage: week.coverage };
}

/**
 * The stored preference row reduced to what the ranker reads.
 *
 * Shared by both surfaces on purpose (BL-0030): the pantry page and week
 * selection rank through the same endpoint, so a taste forwarded by only one of
 * them would be a setting that half works — which is worse than one that does
 * not work at all, because nothing on screen says which half.
 *
 * `maxMinutes` is passed through as-is, INCLUDING undefined. A cleared field
 * must arrive absent rather than as 0: absent is "no opinion" and 0 is a limit
 * no recipe can satisfy.
 */
function rankerPreferences(prefs: {
  avoidItems: string[];
  likedItems: string[];
  dislikedItems: string[];
  cuisines: string[];
  maxMinutes?: number;
}): RecommendationPreferences {
  return {
    avoidItems: prefs.avoidItems,
    likedItems: prefs.likedItems,
    dislikedItems: prefs.dislikedItems,
    cuisines: prefs.cuisines,
    maxMinutes: prefs.maxMinutes,
  };
}

/**
 * Rank recipes against what the user has on hand.
 *
 * This is an ACTION, not a query, because Convex queries cannot do network I/O.
 * Results are therefore fetched rather than reactive — the caller refetches when
 * pantry contents change.
 */
export const pantry = action({
  args: {},
  handler: async (ctx): Promise<Recommendation[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const [pantryRows, preferences, basket, targetRows] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.basket.list, {}),
      ctx.runQuery(api.nutritionTargets.list, {}),
    ]);

    // Active rows only: a paused goal is not a goal, and the ranker should not
    // have to know that pausing exists.
    const nutritionTargets: RecommendationNutritionTarget[] = targetRows
      .filter((t) => t.active)
      .map(({ nutrientId, operator, value, period, label, hard }) => ({
        nutrientId,
        operator,
        value,
        period,
        label,
        hard,
      }));

    const body: RecommendationRequest = {
      nutritionTargets,
      planNutrition: await committedWeek(ctx, nutritionTargets),
      pantry: pantryRows.map((row) => ({
        canonicalItem: row.canonicalItem,
        state: row.state,
        useItUp: row.useItUp ?? false,
        // Shelf life rides along so expiry urgency can be scored here rather
        // than on a second endpoint of its own (BL-0050). Rows the shelf-life
        // table doesn't recognize carry no date and contribute no urgency.
        useBy: row.useBy,
      })),
      preferences: rankerPreferences(preferences),
      // Already-planned recipes are excluded outright: suggesting what is
      // already on the week's plan is noise.
      excludeRecipeIds: basket.map((b: { recipeId: string }) => b.recipeId),
      limit: 20,
      // The clock is sent, not read server-side, so the ranker stays a pure
      // function of its request and its expiry scoring is table-testable.
      now: Date.now(),
    };

    const res = await fetch(`${baseUrl}/recommendations/pantry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Secret": secret,
        "X-User-Id": userId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`recipe-service POST /recommendations/pantry failed: ${res.status}`);
    }
    const payload = (await res.json()) as RecommendationResponse;
    return payload.results ?? [];
  },
});

/**
 * How wide a pool "Suggest my week" selects from.
 *
 * Greedy selection is only as good as what it can choose between: it fills up to
 * seven days and re-scores after each pick, so a pool the size of the week gives
 * it no room to trade a slightly better dish for one that shares a chicken. This
 * is the ranker's `maxLimit`, deliberately — the corpus is small enough that
 * asking for all of it costs nothing.
 */
const WEEK_CANDIDATE_LIMIT = 50;

/**
 * The candidate pool for the week suggester (BL-0033).
 *
 * Deliberately NOT the same request as `pantry` above, in three ways, each of
 * which is a requirement of set selection rather than a tweak:
 *
 *   - `includeUnmatched` keeps recipes that share nothing with the pantry. They
 *     are noise on a "cook what you have" card and essential here, because a
 *     dish can earn its place by sharing ingredients with the OTHER dinners —
 *     and because a new user with an empty pantry would otherwise be told there
 *     is no week to suggest.
 *   - Planned recipes are NOT excluded. The suggester needs their ingredients to
 *     score against the week the user actually has; it is the client's job not
 *     to re-propose them, and `suggestWeek` does exactly that.
 *   - A wider limit, so greedy selection has something to be greedy about.
 *
 * It returns candidates, not a plan. Selection is pure and lives in
 * `@pantry/core`, so the client can re-run it instantly as the user edits the
 * proposal instead of paying a round trip per edit.
 */
export const weekCandidates = action({
  args: {},
  handler: async (ctx): Promise<Recommendation[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const [pantryRows, preferences, targetRows] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.nutritionTargets.list, {}),
    ]);

    const nutritionTargets: RecommendationNutritionTarget[] = targetRows
      .filter((t) => t.active)
      .map(({ nutrientId, operator, value, period, label, hard }) => ({
        nutrientId,
        operator,
        value,
        period,
        label,
        hard,
      }));

    const body: RecommendationRequest = {
      nutritionTargets,
      // A week goal is scored against what the plan already commits, exactly as
      // on the pantry surface — the dinners this call is about to propose are
      // not committed to anything yet.
      planNutrition: await committedWeek(ctx, nutritionTargets),
      pantry: pantryRows.map((row) => ({
        canonicalItem: row.canonicalItem,
        state: row.state,
        useItUp: row.useItUp ?? false,
      })),
      preferences: rankerPreferences(preferences),
      excludeRecipeIds: [],
      includeUnmatched: true,
      limit: WEEK_CANDIDATE_LIMIT,
    };

    const res = await fetch(`${baseUrl}/recommendations/pantry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Secret": secret,
        "X-User-Id": userId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`recipe-service POST /recommendations/pantry failed: ${res.status}`);
    }
    const payload = (await res.json()) as RecommendationResponse;
    return payload.results ?? [];
  },
});
