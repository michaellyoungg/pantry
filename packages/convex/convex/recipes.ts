import type { GroceryLine } from "@pantry/types";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";

// Reads the basket, asks recipe-service to aggregate those recipes into a
// grocery list, and persists the result as the reactive grocery list.
// The aggregation lives in recipe-service (the canonical owner); Convex only
// orchestrates and stores. No recipe bodies are stored here.
export const generateGroceryList = action({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const baseUrl = process.env.RECIPE_SERVICE_URL;
    if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");

    const basket = await ctx.runQuery(api.basket.list, {});
    const recipeIds = basket.map((b: { recipeId: string }) => b.recipeId);

    const res = await fetch(`${baseUrl}/grocery-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeIds }),
    });
    if (!res.ok) {
      throw new Error(`recipe-service /grocery-list failed: ${res.status}`);
    }
    const lines = (await res.json()) as GroceryLine[];

    await ctx.runMutation(internal.groceryList.replaceGroceryList, { lines });
    return { count: lines.length };
  },
});
