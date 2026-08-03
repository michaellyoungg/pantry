import { getAuthUserId } from "@convex-dev/auth/server";
import type { GroceryLine, Ingredient, Recipe } from "@pantry/types";
import { type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { withSpan } from "./lib/otel";
import { lookupShelfLife } from "./lib/recipeService";

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
// When a `traceparent` is supplied it rides along so the Go span (BL-0027)
// nests under the Convex span.
async function recipeServiceFetch<T>(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
  traceparent?: string,
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
      ...(traceparent ? { traceparent } : {}),
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
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { title, ingredients, traceCtx }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.create", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe>(userId, "POST", "/recipes", { title, ingredients }, traceparent),
    );
  },
});

export const list = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<Recipe[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.list", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe[]>(userId, "GET", "/recipes", undefined, traceparent),
    );
  },
});

export const remove = action({
  args: { id: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { id, traceCtx }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await withSpan("recipes.remove", traceCtx, (traceparent) =>
      recipeServiceFetch<void>(userId, "DELETE", `/recipes/${id}`, undefined, traceparent),
    );
    return null;
  },
});

export const update = action({
  args: {
    id: v.string(),
    title: v.string(),
    ingredients: v.array(ingredientValidator),
    traceCtx: v.optional(v.string()),
  },
  handler: async (ctx, { id, title, ingredients, traceCtx }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.update", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe>(
        userId,
        "PUT",
        `/recipes/${id}`,
        { title, ingredients },
        traceparent,
      ),
    );
  },
});

// Imports a recipe from a URL: recipe-service fetches + parses the page and
// returns a PREVIEW recipe (no id, not persisted). The web app drops it into the
// recipe form; the user reviews and saves via the normal create action.
export const importFromUrl = action({
  args: { url: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { url, traceCtx }): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.importFromUrl", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe>(userId, "POST", "/recipes/import", { url }, traceparent),
    );
  },
});

// Lists the shared, system-curated recipe catalog (BL-0002). recipe-service
// scopes /catalog to the catalog owner server-side; the caller's identity is
// only used to satisfy the service auth boundary.
export const listCatalog = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<Recipe[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.listCatalog", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe[]>(userId, "GET", "/catalog", undefined, traceparent),
    );
  },
});

// Reads the basket, asks recipe-service to aggregate those recipes into a
// grocery list, and persists the result as the reactive grocery list.
export const generateGroceryList = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<{ count: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.generateGroceryList", traceCtx, async (traceparent) => {
      const basket = await ctx.runQuery(api.basket.list, {});
      // Leftovers occupy a day but never contribute to the list; every other
      // basketed recipe contributes at its servings multiplier (default 1).
      const items = basket
        .filter((b: { type?: string }) => b.type !== "leftover")
        .map((b: { recipeId: string; servingsMultiplier?: number }) => ({
          recipeId: b.recipeId,
          multiplier: b.servingsMultiplier ?? 1,
        }));

      const lines = await recipeServiceFetch<GroceryLine[]>(
        userId,
        "POST",
        "/grocery-list",
        { items },
        traceparent,
      );

      // Resolve approximate shelf life for the list's canonical items (BL-0029).
      // It has to happen here, in an action: check-off is a mutation and
      // mutations cannot do network I/O, so the number must already be on the
      // line by the time the box is ticked.
      const shelfLife = await lookupShelfLife(
        userId,
        [...new Set(lines.map((l) => l.canonicalItem).filter(Boolean))],
        traceparent,
      );

      await ctx.runMutation(internal.groceryList.mergeGroceryList, { userId, lines, shelfLife });
      return { count: lines.length };
    });
  },
});
