import { api } from "@pantry/convex/api";
import type { PrepTask, Recipe } from "@pantry/types";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { useAsyncData } from "../react/useAsyncData";
import { type PrepForRecipe, useRecipePrep } from "./useRecipePrep";

/** `recipes.get`. Injectable so web can pass its traced wrapper. */
export type GetRecipe = (
  args: FunctionArgs<typeof api.recipes.get>,
) => Promise<FunctionReturnType<typeof api.recipes.get>>;

/** `recipes.listEquipment`. Injectable for the same reason. */
export type ListEquipment = (
  args: FunctionArgs<typeof api.recipes.listEquipment>,
) => Promise<FunctionReturnType<typeof api.recipes.listEquipment>>;

/** One equipment requirement with its catalog name already resolved. */
export type RecipeEquipmentLine = {
  id: string;
  /** The catalog's name, falling back to the slug when the catalog lacks it. */
  name: string;
  required: boolean;
};

export type UseRecipeDetail = {
  /** The recipe, or `undefined` until it arrives (and if it never does). */
  recipe: Recipe | undefined;
  /** True until the recipe request settles — distinct from "there is no such recipe". */
  loading: boolean;
  /**
   * The id resolved to no recipe. A real, ordinary state: the plan can outlive
   * the recipe it points at, so a screen opened from it has to be able to say
   * "this is gone" rather than "something went wrong".
   */
  missing: boolean;
  /** A failed load, already stringified. */
  error: string | null;
  /** Lead-time prep for this recipe. Windows, not dates — see `useRecipePrep`. */
  prepTasks: PrepTask[];
  prepLoading: boolean;
  /** The recipe's hardware, catalog names resolved. Empty when it needs none. */
  equipment: RecipeEquipmentLine[];
  /** Re-run the recipe request, e.g. from a retry affordance. */
  reload: () => void;
};

/**
 * Everything a recipe screen needs, with no view attached (BL-0055).
 *
 * Three sources, deliberately independent: the recipe itself, its derived prep
 * (a second action, against the rule table), and the equipment catalog. A
 * failure in any one of them leaves the others renderable — the point of
 * cooking mode is that you are stood at a hob with wet hands, and a screen that
 * blanks because the prep rules were slow is worse than one missing a line.
 *
 * The catalog is only fetched when the recipe actually lists equipment, so the
 * common recipe costs two requests rather than three.
 */
export function useRecipeDetail(
  recipeId: string,
  {
    getRecipe,
    forRecipe,
    listEquipment,
    now,
    enabled = true,
  }: {
    getRecipe?: GetRecipe;
    forRecipe?: PrepForRecipe;
    listEquipment?: ListEquipment;
    now?: Date;
    /**
     * `false` makes every request a no-op, for a screen that mounts before it
     * knows whether there is a recipe to load — the rules of hooks mean it
     * cannot simply skip the call. `loading` then stays false and `missing`
     * never becomes true, so nothing downstream mistakes "not asked" for "gone".
     */
    enabled?: boolean;
  } = {},
): UseRecipeDetail {
  const getRecipeAction = useAction(api.recipes.get);
  const listEquipmentAction = useAction(api.recipes.listEquipment);
  const fetchRecipe = getRecipe ?? getRecipeAction;
  const fetchCatalog = listEquipment ?? listEquipmentAction;

  const loadRecipe = useCallback(
    () =>
      enabled
        ? fetchRecipe({ id: recipeId })
        : Promise.resolve<FunctionReturnType<typeof api.recipes.get>>(null),
    [enabled, fetchRecipe, recipeId],
  );
  const { data, loading, error, reload } = useAsyncData(loadRecipe);
  const recipe = data ?? undefined;

  const { tasks, loading: prepLoading } = useRecipePrep(recipeId, { forRecipe, now, enabled });

  // Reference data, the same for every user, so it is fetched once per screen
  // rather than per requirement. Carried through the dependency list as a
  // string: the array is a fresh reference every render, which would re-request
  // forever, and a string compares by value.
  const equipmentKey = (recipe?.equipment ?? []).map((e) => e.id).join(",");
  const loadCatalog = useCallback(
    () =>
      equipmentKey === ""
        ? Promise.resolve<FunctionReturnType<typeof api.recipes.listEquipment>>([])
        : fetchCatalog({}),
    [equipmentKey, fetchCatalog],
  );
  const { data: catalog } = useAsyncData(loadCatalog);

  const equipment = (recipe?.equipment ?? []).map((e) => ({
    id: e.id,
    // Falls back to the slug so a requirement whose catalog entry is missing —
    // or whose catalog request failed — still renders as something rather than
    // disappearing off a recipe the user is about to cook from.
    name: (catalog ?? []).find((def) => def.id === e.id)?.name ?? e.id,
    required: e.required,
  }));

  return {
    recipe,
    loading,
    missing: enabled && !loading && error === null && data === null,
    error,
    prepTasks: tasks,
    prepLoading,
    equipment,
    reload,
  };
}
