import { api } from "@pantry/convex/api";
import type { NutritionEstimate } from "@pantry/types";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { type RecipeNutritionView, recipeNutritionView } from "../nutritionRecipe";
import { useAsyncData } from "../react/useAsyncData";
import { useNutritionTargets } from "./useNutritionTargets";

/** `recipes.nutrition`. Injectable so web can pass its traced wrapper. */
export type EstimateRecipeNutrition = (
  args: FunctionArgs<typeof api.recipes.nutrition>,
) => Promise<FunctionReturnType<typeof api.recipes.nutrition>>;

export type UseRecipeNutrition = {
  /** The raw estimate, for a caller that needs the provenance behind the view. */
  estimate: NutritionEstimate | undefined;
  /**
   * What to draw, or `null` until an estimate exists. Every decision about
   * whether a figure may be shown at all is already made — see
   * `recipeNutritionView`.
   */
  view: RecipeNutritionView | null;
  /** True until the estimate settles. Nutrition is a round trip, not a query. */
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Estimated nutrition for one recipe (BL-0036, BL-0049), with no view attached.
 *
 * Estimating is an action rather than a subscription — it fans out to
 * recipe-service — so this is `useAsyncData` and not `useQuery`, and the three
 * states stay distinct: a client must be able to say "estimating…" without
 * saying "no nutrition".
 *
 * The goals come in through `useNutritionTargets`, so the panel's personal
 * column and the verdict above it are scored against the same list the plan
 * uses.
 */
export function useRecipeNutrition(
  recipeId: string,
  { getNutrition }: { getNutrition?: EstimateRecipeNutrition } = {},
): UseRecipeNutrition {
  const nutritionAction = useAction(api.recipes.nutrition);
  const estimateRecipe = getNutrition ?? nutritionAction;
  const { targets } = useNutritionTargets();

  const load = useCallback(() => estimateRecipe({ id: recipeId }), [estimateRecipe, recipeId]);
  const { data, loading, error, reload } = useAsyncData(load, [recipeId]);

  return {
    estimate: data,
    view: data ? recipeNutritionView(data, targets) : null,
    loading,
    error,
    reload,
  };
}
