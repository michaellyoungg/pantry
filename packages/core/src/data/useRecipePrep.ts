import { api } from "@pantry/convex/api";
import type { PrepTask } from "@pantry/types";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { toISODate } from "../calendar";
import { useAsyncData } from "../react/useAsyncData";

/** `prepTasks.forRecipe`. Injectable so web can pass its traced wrapper. */
export type PrepForRecipe = (
  args: FunctionArgs<typeof api.prepTasks.forRecipe>,
) => Promise<FunctionReturnType<typeof api.prepTasks.forRecipe>>;

export type UseRecipePrep = {
  /** This recipe's prep, in window order as the service returned it. */
  tasks: PrepTask[];
  loading: boolean;
  /** A failed derivation. The recipe around it is still readable. */
  error: string | null;
};

/**
 * One recipe's derived prep — the "before you start" list (BL-0042).
 *
 * Windows, not dates, and no check-off: a recipe you are reading has no cook
 * date — it may never be scheduled — so "the night before" is the only true
 * statement available, and a tick with no meal to belong to would have nowhere
 * to be stored. Check-off lives in `usePlanPrep`, where a task is attached to
 * an actual dinner.
 *
 * The derivation still needs *a* date to resolve windows against, so today is
 * passed and the resulting dates are deliberately not part of this contract.
 */
export function useRecipePrep(
  recipeId: string,
  { forRecipe, now = new Date() }: { forRecipe?: PrepForRecipe; now?: Date } = {},
): UseRecipePrep {
  const forRecipeAction = useAction(api.prepTasks.forRecipe);
  const derive = forRecipe ?? forRecipeAction;
  const cookDate = toISODate(now);

  const load = useCallback(() => derive({ recipeId, cookDate }), [derive, recipeId, cookDate]);
  const { data, loading, error } = useAsyncData(load);

  // `null` is a recipe the derivation could not read at all, which is the same
  // answer for this surface as a recipe that needs no prep: nothing to show.
  return { tasks: data?.tasks ?? [], loading, error };
}
