import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { GroceryLine, Recipe } from "@pantry/types";
import { getAuthUserId } from "@convex-dev/auth/server";

const ingredientValidator = v.object({
  quantity: v.number(),
  unit: v.string(),
  item: v.string(),
  note: v.optional(v.string()),
});

// Calls recipe-service as Convex: proves identity with the shared secret and
// forwards the authenticated user id. Never reachable from the browser.
async function recipeServiceFetch<T>(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = process.env.RECIPE_SERVICE_URL;
  if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
  const secret = process.env.RECIPE_SERVICE_SECRET;
  if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Service-Secret": secret,
      "X-User-Id": userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`recipe-service ${method} ${path} failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const create = action({
  args: { title: v.string(), ingredients: v.array(ingredientValidator) },
  handler: async (ctx, { title, ingredients }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "POST", "/recipes", { title, ingredients });
  },
});

export const list = action({
  args: {},
  handler: async (ctx): Promise<Recipe[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe[]>(userId, "GET", "/recipes");
  },
});

export const remove = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await recipeServiceFetch<void>(userId, "DELETE", `/recipes/${id}`);
    return null;
  },
});

export const update = action({
  args: { id: v.string(), title: v.string(), ingredients: v.array(ingredientValidator) },
  handler: async (ctx, { id, title, ingredients }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "PUT", `/recipes/${id}`, { title, ingredients });
  },
});

// Reads the basket, asks recipe-service to aggregate those recipes into a
// grocery list, and persists the result as the reactive grocery list.
export const generateGroceryList = action({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const basket = await ctx.runQuery(api.basket.list, {});
    const recipeIds = basket.map((b: { recipeId: string }) => b.recipeId);

    const lines = await recipeServiceFetch<GroceryLine[]>(userId, "POST", "/grocery-list", {
      recipeIds,
    });

    await ctx.runMutation(internal.groceryList.replaceGroceryList, { userId, lines });
    return { count: lines.length };
  },
});
