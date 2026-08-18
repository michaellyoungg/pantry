import { api } from "@pantry/convex/api";
import type { PrepTaskInput, Recipe } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { addToBasketOptimistic, removeFromBasketOptimistic } from "../convex/optimistic";
import { defaultServingsMultiplier } from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";
import { useAsyncData } from "../react/useAsyncData";
import { useHouseholdSize } from "./useHouseholdSize";

/** `recipes.list`. Injectable so web can pass its traced wrapper. */
export type ListRecipes = (
  args: FunctionArgs<typeof api.recipes.list>,
) => Promise<FunctionReturnType<typeof api.recipes.list>>;

/** `recipes.remove`. Injectable for the same reason. */
export type RemoveRecipe = (
  args: FunctionArgs<typeof api.recipes.remove>,
) => Promise<FunctionReturnType<typeof api.recipes.remove>>;

/** `recipes.update`. Injectable for the same reason. */
export type UpdateRecipe = (
  args: FunctionArgs<typeof api.recipes.update>,
) => Promise<FunctionReturnType<typeof api.recipes.update>>;

/**
 * A whole-recipe replacement, as the update action takes it.
 *
 * `update` replaces the recipe, so every field must be sent every time — an
 * omitted one clears the stored value. Spelled as an object rather than a
 * positional list because with eleven fields a caller swapping two adjacent
 * strings is a bug the compiler cannot see.
 */
export interface RecipeEdit {
  title: string;
  servings: number | undefined;
  ingredients: Recipe["ingredients"];
  steps: string[];
  equipment: Recipe["equipment"];
  methods: Recipe["methods"];
  cuisine: string;
  totalMinutes: number | undefined;
  tags: string[];
  sourceUrl: string | undefined;
  /**
   * The user's own prep tasks (BL-0044). Unlike every field above this does not
   * replace the recipe's whole prep — model-derived tasks are a separate
   * producer and survive an edit untouched.
   */
  prepTasks: PrepTaskInput[];
}

export type UseMyRecipes = {
  /** The user's own recipes, newest first as the service returns them. */
  recipes: Recipe[];
  /** True until the first response — distinct from "you have no recipes". */
  loading: boolean;
  /** A failed load, already stringified. Separate from `error`. */
  loadError: string | null;
  /** The most recent failed write, already stringified. */
  error: string | null;
  /**
   * Titles held by more than one recipe, normalized on trim + case.
   *
   * Duplicates stay LEGAL (BL-0013): importing the same page twice, or keeping
   * two takes on "Chili", is normal, and blocking the write would be worse than
   * the mess. The fix is visibility, so the screen can flag them and let the
   * user prune.
   */
  duplicateTitles: Set<string>;
  /** Whether a recipe's title collides with another's. */
  isDuplicate: (recipe: Recipe) => boolean;
  /** Basket the recipe at the household's default batch size (BL-0018). */
  addToBasket: (recipe: Recipe) => void;
  /** Delete the recipe, then reconcile the basket best-effort. */
  remove: (recipe: Recipe) => Promise<void>;
  /** Save a whole-recipe replacement, then reconcile the basket title. */
  save: (recipeId: string, edit: RecipeEdit) => Promise<boolean>;
  /** Re-run the list request, e.g. after creating a recipe elsewhere. */
  reload: () => void;
  clearError: () => void;
};

/**
 * The "My recipes" collection, with no view attached (BL-0055).
 *
 * The web list and the native one render the same three writes — basket, delete
 * and whole-recipe update — and each of them has a second, best-effort step
 * against the Convex basket that must never roll the primary op back. That
 * ordering is the reason this is one hook rather than three call sites: the
 * recipe-service op is the source of truth, and a basket failure afterwards is
 * reported as a note while the list reloads to reflect what actually happened.
 */
export function useMyRecipes({
  listRecipes,
  removeRecipe,
  updateRecipe,
}: {
  listRecipes?: ListRecipes;
  removeRecipe?: RemoveRecipe;
  updateRecipe?: UpdateRecipe;
} = {}): UseMyRecipes {
  const listAction = useAction(api.recipes.list);
  const removeAction = useAction(api.recipes.remove);
  const updateAction = useAction(api.recipes.update);
  const fetchList = listRecipes ?? listAction;
  const deleteRecipe = removeRecipe ?? removeAction;
  const saveRecipe = updateRecipe ?? updateAction;

  const addToBasketMutation = useMutation(api.basket.add).withOptimisticUpdate(
    addToBasketOptimistic,
  );
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const householdSize = useHouseholdSize();

  const load = useCallback(() => fetchList({}), [fetchList]);
  const { data, loading, error: loadError, reload } = useAsyncData(load);
  const { run, error, clearError, showError } = useAsyncAction();
  const recipes = useMemo(() => data ?? [], [data]);

  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes) {
      const key = titleKey(r.title);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
  }, [recipes]);

  const addToBasket = useCallback(
    (recipe: Recipe) => {
      void run(() =>
        addToBasketMutation({
          recipeId: recipe.id,
          title: recipe.title,
          servingsMultiplier: defaultServingsMultiplier(householdSize, recipe.servings),
        }),
      );
    },
    [run, addToBasketMutation, householdSize],
  );

  const remove = useCallback(
    async (recipe: Recipe) => {
      const deleted = await run(async () => {
        await deleteRecipe({ id: recipe.id });
        return true;
      });
      if (!deleted) return;
      try {
        await removeFromBasket({ recipeId: recipe.id }); // idempotent no-op if not in basket
      } catch {
        showError(
          `Deleted "${recipe.title}", but couldn't update the basket — it may show a stale item until reload.`,
        );
      }
      reload();
    },
    [run, deleteRecipe, removeFromBasket, showError, reload],
  );

  const save = useCallback(
    async (recipeId: string, edit: RecipeEdit) => {
      const saved = await run(async () => {
        await saveRecipe({ id: recipeId, ...edit });
        return true;
      });
      if (!saved) return false;
      try {
        // idempotent no-op if not in basket
        await updateBasketTitle({ recipeId, title: edit.title });
      } catch {
        showError(
          `Saved "${edit.title}", but couldn't update the basket title — it may show the old title until reload.`,
        );
      }
      reload();
      return true;
    },
    [run, saveRecipe, updateBasketTitle, showError, reload],
  );

  return {
    recipes,
    loading,
    loadError,
    error,
    duplicateTitles,
    isDuplicate: (recipe) => duplicateTitles.has(titleKey(recipe.title)),
    addToBasket,
    remove,
    save,
    reload,
    clearError,
  };
}

/** "Garlic Bread" and "garlic bread " are the same title for de-dup purposes. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}
