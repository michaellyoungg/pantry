import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine, Ingredient, Recipe } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";

const ingredientValidator = v.object({
  quantity: v.number(),
  unit: v.string(),
  item: v.string(),
  note: v.optional(v.string()),
});

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if ingredientValidator and @pantry/types Ingredient drift,
// mirroring the guard on groceryList.ts's groceryLineValidator.
export const _ingredientInSync: Equals<Infer<typeof ingredientValidator>, Ingredient> = true;

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
  args: {
    title: v.string(),
    ingredients: v.array(ingredientValidator),
    steps: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { title, ingredients, steps }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "POST", "/recipes", {
      title,
      ingredients,
      steps: steps ?? [],
    });
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
  args: {
    id: v.string(),
    title: v.string(),
    ingredients: v.array(ingredientValidator),
    steps: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, title, ingredients, steps }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "PUT", `/recipes/${id}`, {
      title,
      ingredients,
      steps: steps ?? [],
    });
  },
});

// Imports a recipe from a URL: recipe-service fetches + parses the page and
// returns a PREVIEW recipe (no id, not persisted). The web app drops it into the
// recipe form; the user reviews and saves via the normal create action.
export const importFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe>(userId, "POST", "/recipes/import", { url });
  },
});

// Lists the shared, system-curated recipe catalog (BL-0002). recipe-service
// scopes /catalog to the catalog owner server-side; the caller's identity is
// only used to satisfy the service auth boundary.
export const listCatalog = action({
  args: {},
  handler: async (ctx): Promise<Recipe[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return recipeServiceFetch<Recipe[]>(userId, "GET", "/catalog");
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
    // Leftovers occupy a day but never contribute to the list; every other
    // basketed recipe contributes at its servings multiplier (default 1).
    const items = basket
      .filter((b: { type?: string }) => b.type !== "leftover")
      .map((b: { recipeId: string; servingsMultiplier?: number }) => ({
        recipeId: b.recipeId,
        multiplier: b.servingsMultiplier ?? 1,
      }));

    const lines = await recipeServiceFetch<GroceryLine[]>(userId, "POST", "/grocery-list", {
      items,
    });

    await ctx.runMutation(internal.groceryList.mergeGroceryList, { userId, lines });
    return { count: lines.length };
  },
});
