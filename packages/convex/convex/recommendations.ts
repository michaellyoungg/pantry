import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  DiscoverResponse,
  GeneratedRecipeDraft,
  Recipe,
  Recommendation,
  RecommendationNutritionTarget,
  RecommendationPlanNutrition,
  RecommendationPreferences,
  RecommendationRequest,
  RecommendationResponse,
} from "@pantry/types";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import type { DerivedSignal } from "./lib/affinity";
import type { PlanNutritionResult } from "./nutrition";
import { ingredientValidator, recipeServiceFetch } from "./recipes";

// How long we wait on recipe-service before giving up. Recommendations are
// additive — a slow ranker must never hang the Pantry page.
//
// It is generous because generation (BL-0034) happens INSIDE this request when
// the corpus came up thin, and a model call is seconds rather than milliseconds.
// The budget only bites on the cold-start path, where the alternative on screen
// is an empty card, and the card renders its local expiring-items strip while it
// waits. recipe-service bounds its own generation call below this figure.
const TIMEOUT_MS = 20_000;

/**
 * What the pantry surface returns: the ranked list, plus the full text of any
 * generated candidate in it.
 *
 * The drafts are a SIDECAR rather than a field on each recommendation because
 * `Recommendation` mirrors the Go ranker's own result type, and the ranker knows
 * nothing about recipe bodies. Joining on `recipeId` keeps that boundary intact.
 */
export interface PantryRecommendations {
  results: Recommendation[];
  generated: GeneratedRecipeDraft[];
}

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
 * The user's taste as derived from their interaction log (BL-0005 increment 2).
 *
 * Folded HERE, at request time, and never written back anywhere. A stored
 * per-user per-ingredient score would be a second source of truth about the same
 * events, and the day it drifted from them nothing would say which was right.
 *
 * An empty `affinities` map is the cold-start case and is sent as-is: the ranker
 * reads emptiness as "no signal" and drops the feature out of its average
 * entirely, rather than scoring every candidate zero. See `lib/affinity.ts` and
 * `internal/recommend/affinity.go` — this is the same rule stated on both sides
 * of the wire, because getting it wrong on either one punishes every new user.
 */
async function derivedSignal(ctx: ActionCtx, userId: string): Promise<DerivedSignal> {
  return ctx.runQuery(internal.recommendationEvents.signalFor, { userId, now: Date.now() });
}

/**
 * Rank recipes against what the user has on hand.
 *
 * This is an ACTION, not a query, because Convex queries cannot do network I/O.
 * Results are therefore fetched rather than reactive — the caller refetches when
 * pantry contents change.
 *
 * When the corpus comes up thin, recipe-service may add generated candidates
 * (BL-0034). They arrive in `results` like any other recommendation, marked
 * `source: "generated"`, with their full text in `generated` so accepting one
 * can persist it. Nothing here has to know whether generation is configured:
 * unconfigured, the sidecar is simply empty.
 */
export const pantry = action({
  args: {},
  handler: async (ctx): Promise<PantryRecommendations> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const [pantryRows, preferences, basket, targetRows, signal] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.basket.list, {}),
      ctx.runQuery(api.nutritionTargets.list, {}),
      derivedSignal(ctx, userId),
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
      // Taste carries its LOWEST weight on this surface (see
      // DefaultPantryWeights): a good reason to reorder what you could cook
      // tonight, and a bad reason to overrule what is about to spoil.
      //
      // `interactions` is deliberately not sent — `novelty` is a discovery
      // concern, and being told a recipe is new is not an answer to "what can I
      // make with this spinach".
      affinities: signal.affinities,
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
    return { results: payload.results ?? [], generated: payload.generated ?? [] };
  },
});

/**
 * How many suggestions the discovery surface asks for.
 *
 * Smaller than the pantry surface's 20 because the question is different: "what
 * can I cook from this fridge" is a search whose answers the user scans, while
 * "what should I try" is a recommendation, and a list of twenty of those is not
 * a recommendation at all. It is also what the card renders without a scroll.
 */
const DISCOVER_LIMIT = 8;

/**
 * "What should I try?" — the discovery surface (BL-0005 increment 2).
 *
 * The sibling of `pantry` above, and deliberately a SEPARATE action hitting a
 * separate endpoint rather than a flag on the existing one. The two intents pull
 * in opposite directions — "cook what I have" rewards the familiar, "try
 * something new" rewards the unfamiliar — so the same features carry different
 * weights, and one endpoint switching on a boolean would be two rankers sharing
 * a name.
 *
 * What it sends that the pantry surface does not:
 *
 *  - `interactions`, so the ranker can prefer things this user has not already
 *    been shown six times. Always sent, even when EMPTY: an empty history says
 *    "this user has interacted with nothing", which makes every candidate
 *    equally new, and that is a real observation rather than a gap.
 *  - The pantry itself still rides along, because "and you could cook it
 *    tonight" is a genuine tiebreak — just a small-weighted one, or discovery
 *    quietly becomes the pantry endpoint under another name.
 *
 * Recipes already on the plan are excluded, and recipes the user already owns a
 * copy of are removed by recipe-service, which is the only side that knows which
 * catalog rows were cloned.
 */
export const discover = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<Recommendation[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
    const secret = process.env.RECIPE_SERVICE_SECRET;
    if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

    const [pantryRows, preferences, basket, targetRows, signal] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.basket.list, {}),
      ctx.runQuery(api.nutritionTargets.list, {}),
      derivedSignal(ctx, userId),
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
      planNutrition: await committedWeek(ctx, nutritionTargets),
      pantry: pantryRows.map((row) => ({
        canonicalItem: row.canonicalItem,
        state: row.state,
        useItUp: row.useItUp ?? false,
      })),
      preferences: rankerPreferences(preferences),
      affinities: signal.affinities,
      interactions: signal.interactions,
      excludeRecipeIds: basket.map((b: { recipeId: string }) => b.recipeId),
      limit: limit ?? DISCOVER_LIMIT,
      now: Date.now(),
    };

    const res = await fetch(`${baseUrl}/recommendations/discover`, {
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
      throw new Error(`recipe-service POST /recommendations/discover failed: ${res.status}`);
    }
    const payload = (await res.json()) as DiscoverResponse;
    return payload.results ?? [];
  },
});

/**
 * Turn an accepted generated suggestion into a real recipe the user owns.
 *
 * This is the only moment a generated recipe is stored (BL-0034). Candidates
 * nobody accepts are forgotten when the request that produced them ends, which
 * is why the draft has to travel back to the client and then back here — there
 * is no server-side row to point at in between.
 *
 * The draft is written through the SAME `POST /recipes` every other recipe uses,
 * so it is validated identically and ends up an ordinary, editable, plannable
 * recipe. The one thing added is the `ai-generated` tag: the row should still
 * say where it came from a month later, when the card that labelled it is long
 * gone.
 */
const GENERATED_TAG = "ai-generated";

export const acceptGenerated = action({
  args: {
    title: v.string(),
    servings: v.optional(v.number()),
    ingredients: v.array(ingredientValidator),
    steps: v.array(v.string()),
  },
  handler: async (ctx, { title, servings, ingredients, steps }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    return recipeServiceFetch<Recipe>(userId, "POST", "/recipes", {
      title,
      servings,
      ingredients,
      steps,
      equipment: [],
      methods: [],
      cuisine: "",
      tags: [GENERATED_TAG],
      sourceUrl: "",
    });
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
