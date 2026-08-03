import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  CookingMethod,
  EquipmentDef,
  GroceryLine,
  Ingredient,
  NutritionEstimate,
  Recipe,
} from "@pantry/types";
import { type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { withSpan } from "./lib/otel";

const ingredientValidator = v.object({
  quantity: v.number(),
  unit: v.string(),
  item: v.string(),
  note: v.optional(v.string()),
});

// Equipment tags reference recipe-service's curated catalog by slug; the
// service validates the id and rejects anything outside it (400), so Convex
// does not duplicate the catalog just to re-check it.
const recipeEquipmentValidator = v.object({
  id: v.string(),
  required: v.boolean(),
});

// The closed method enum, so a bad literal is rejected at the Convex boundary
// rather than deep in the Go service. Declared here rather than imported as a
// value: @pantry/types ships as dist only, and the Convex bundler resolves it
// without a build step only while every import from it is `import type`. The
// _cookingMethodInSync guard below makes this list provably identical to the
// CookingMethod union, so the duplication cannot drift silently.
const COOKING_METHODS = [
  "bake",
  "roast",
  "grill",
  "smoke",
  "sous_vide",
  "slow_cook",
  "pressure_cook",
  "fry",
  "saute",
  "boil",
  "marinate",
  "no_cook",
] as const;

const cookingMethodValidator = v.union(...COOKING_METHODS.map((m) => v.literal(m)));

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if ingredientValidator and @pantry/types Ingredient drift,
// mirroring the guard on groceryList.ts's groceryLineValidator.
export const _ingredientInSync: Equals<Infer<typeof ingredientValidator>, Ingredient> = true;
// Same guard for the method enum: fails to compile if the local COOKING_METHODS
// list stops covering @pantry/types' CookingMethod union exactly.
export const _cookingMethodInSync: Equals<
  Infer<typeof cookingMethodValidator>,
  CookingMethod
> = true;

// Calls recipe-service as Convex: proves identity with the shared secret and
// forwards the authenticated user id. Never reachable from the browser.
// When a `traceparent` is supplied it rides along so the Go span (BL-0027)
// nests under the Convex span.
export async function recipeServiceFetch<T>(
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

/** One entry of POST /normalization/lookup. `shelfLifeDays` is absent when unknown. */
export interface NormalizedItem {
  canonicalItem: string;
  display: string;
  aisle: string;
  shelfLifeDays?: number;
}

/**
 * Resolve approximate shelf life for a set of canonical items, as
 * canonicalItem -> days (BL-0029). Items recipe-service doesn't recognize are
 * simply absent from the result — never defaulted, because a guessed date is
 * worse than no date.
 */
async function lookupShelfLife(
  userId: string,
  items: string[],
  traceparent?: string,
): Promise<Record<string, number>> {
  if (items.length === 0) return {};
  const res = await recipeServiceFetch<{ items: NormalizedItem[] }>(
    userId,
    "POST",
    "/normalization/lookup",
    { items },
    traceparent,
  );
  const out: Record<string, number> = {};
  for (const item of res.items ?? []) {
    if (item.shelfLifeDays !== undefined) out[item.canonicalItem] = item.shelfLifeDays;
  }
  return out;
}

// servings is optional end to end: omitting it means "yield unknown" (BL-0035),
// which is the normal case for manual entry and for every recipe that predates
// the field. recipe-service validates the range.
export const create = action({
  args: {
    title: v.string(),
    servings: v.optional(v.number()),
    ingredients: v.array(ingredientValidator),
    steps: v.optional(v.array(v.string())),
    equipment: v.optional(v.array(recipeEquipmentValidator)),
    methods: v.optional(v.array(cookingMethodValidator)),
    traceCtx: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { title, servings, ingredients, steps, equipment, methods, traceCtx },
  ): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.create", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe>(
        userId,
        "POST",
        "/recipes",
        {
          title,
          servings,
          ingredients,
          steps: steps ?? [],
          equipment: equipment ?? [],
          methods: methods ?? [],
        },
        traceparent,
      ),
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

// Referential integrity (BL-0013). Recipes live in recipe-service; the basket
// (which doubles as the week plan) lives in Convex and holds recipeId strings
// no database can enforce a foreign key on. Reconciling here — rather than only
// in the browser after the call returns — means the guarantee holds for EVERY
// caller: a second tab, a future mobile client, an e2e script, or a web client
// that navigates away mid-flight.
//
// Deliberately best-effort: the recipe-service delete has already committed by
// the time we get here, so a failing basket write must NOT turn a successful
// delete into a thrown action. That would roll the UI back into claiming the
// recipe still exists — exactly the cross-store inconsistency BL-0015 fixed.
// A surviving basket row degrades gracefully: grocery-list aggregation already
// skips unresolvable recipe ids (and logs them), and the web client runs the
// same cleanup again as a second chance.
async function reconcileBasket(op: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`recipes.${op}: basket reconciliation failed`, err);
  }
}

export const remove = action({
  args: { id: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { id, traceCtx }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await withSpan("recipes.remove", traceCtx, (traceparent) =>
      recipeServiceFetch<void>(userId, "DELETE", `/recipes/${id}`, undefined, traceparent),
    );
    // The recipe is gone; drop any basket/week-plan row still pointing at it.
    // Idempotent no-op when the recipe was never basketed.
    await reconcileBasket("remove", () => ctx.runMutation(api.basket.remove, { recipeId: id }));
    return null;
  },
});

// Update replaces the whole recipe, so omitting servings clears a previously
// known yield rather than leaving it in place — callers must send the current
// value to keep it.
export const update = action({
  args: {
    id: v.string(),
    title: v.string(),
    servings: v.optional(v.number()),
    ingredients: v.array(ingredientValidator),
    steps: v.optional(v.array(v.string())),
    equipment: v.optional(v.array(recipeEquipmentValidator)),
    methods: v.optional(v.array(cookingMethodValidator)),
    traceCtx: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { id, title, servings, ingredients, steps, equipment, methods, traceCtx },
  ): Promise<Recipe> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const updated = await withSpan("recipes.update", traceCtx, (traceparent) =>
      recipeServiceFetch<Recipe>(
        userId,
        "PUT",
        `/recipes/${id}`,
        {
          title,
          servings,
          ingredients,
          steps: steps ?? [],
          equipment: equipment ?? [],
          methods: methods ?? [],
        },
        traceparent,
      ),
    );
    // The basket denormalizes the title for display, so a rename has to reach
    // it or the week plan keeps showing the old name. Same best-effort contract
    // as remove(): never fail an update that already committed.
    await reconcileBasket("update", () =>
      ctx.runMutation(api.basket.updateTitle, { recipeId: id, title }),
    );
    return updated;
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

// Serves the curated equipment catalog (BL-0041) so the recipe form can offer a
// picker and recipe detail can render equipment names. It is reference data, the
// same for every caller, but still goes through the service boundary rather than
// being duplicated in the web bundle.
export const listEquipment = action({
  args: { traceCtx: v.optional(v.string()) },
  handler: async (ctx, { traceCtx }): Promise<EquipmentDef[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.listEquipment", traceCtx, (traceparent) =>
      recipeServiceFetch<EquipmentDef[]>(userId, "GET", "/equipment", undefined, traceparent),
    );
  },
});

// Estimated nutrition for one recipe (BL-0036). recipe-service computes this on
// read rather than storing it on the recipe, so it cannot go stale when a recipe
// is edited or a food mapping is corrected. The estimate always carries a
// coverage report; the UI is responsible for not presenting a low-coverage
// figure as a complete one.
export const nutrition = action({
  args: { id: v.string(), traceCtx: v.optional(v.string()) },
  handler: async (ctx, { id, traceCtx }): Promise<NutritionEstimate> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return withSpan("recipes.nutrition", traceCtx, (traceparent) =>
      recipeServiceFetch<NutritionEstimate>(
        userId,
        "GET",
        `/recipes/${id}/nutrition`,
        undefined,
        traceparent,
      ),
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
