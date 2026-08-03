import { getAuthUserId } from "@convex-dev/auth/server";
import type { Recommendation, RecommendationResponse } from "@pantry/types";
import { api } from "./_generated/api";
import { action } from "./_generated/server";

// How long we wait on recipe-service before giving up. Recommendations are
// additive — a slow ranker must never hang the Pantry page.
const TIMEOUT_MS = 5_000;

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

    const [pantryRows, preferences, basket] = await Promise.all([
      ctx.runQuery(api.pantry.list, {}),
      ctx.runQuery(api.preferences.get, {}),
      ctx.runQuery(api.basket.list, {}),
    ]);

    const body = {
      pantry: pantryRows.map((row) => ({
        canonicalItem: row.canonicalItem,
        state: row.state,
        useItUp: row.useItUp ?? false,
      })),
      preferences: {
        avoidItems: preferences.avoidItems,
        likedItems: preferences.likedItems,
        dislikedItems: preferences.dislikedItems,
      },
      // Already-planned recipes are excluded outright: suggesting what is
      // already on the week's plan is noise.
      excludeRecipeIds: basket.map((b: { recipeId: string }) => b.recipeId),
      limit: 20,
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
