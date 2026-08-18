import { api } from "@pantry/convex/api";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import {
  type PlanNutritionView,
  planNutritionSignature,
  planNutritionView,
} from "../nutritionRollup";
import type { PlannedItem } from "../planner";
import { useAsyncData } from "../react/useAsyncData";
import { useNutritionTargets } from "./useNutritionTargets";

/** `nutrition.planNutrition`. Injectable so web can pass its traced wrapper. */
export type EstimatePlanNutrition = (
  args: FunctionArgs<typeof api.nutrition.planNutrition>,
) => Promise<FunctionReturnType<typeof api.nutrition.planNutrition>>;

export type UsePlanNutrition = {
  /**
   * What to draw, or `null` until the rollup arrives. `view.rollup.plannedDays`
   * is 0 when the week holds no food, which is a different thing from `null`.
   */
  view: PlanNutritionView | null;
  /** True while a rollup is in flight, including a refresh over stale figures. */
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * The week's estimated nutrition (BL-0037) and how it sits against the user's
 * goals (BL-0038), with no view attached.
 *
 * One request serves both halves. Asking twice would let the totals and the
 * goal chips disagree about whether a day is knowable, which is the exact
 * failure the coverage rule exists to prevent.
 *
 * @param items The basket as it stands. Only its nutrition-relevant shape is
 *   read: `planNutritionSignature` re-asks on a real edit and not on a
 *   re-render, and deliberately ignores meal ↔ leftover, since a leftover is
 *   eaten either way.
 */
export function usePlanNutrition(
  items: readonly PlannedItem[],
  { planNutrition }: { planNutrition?: EstimatePlanNutrition } = {},
): UsePlanNutrition {
  const planNutritionAction = useAction(api.nutrition.planNutrition);
  const estimatePlan = planNutrition ?? planNutritionAction;
  const { targets } = useNutritionTargets();

  const load = useCallback(() => estimatePlan({}), [estimatePlan]);
  const { data, loading, error, reload } = useAsyncData(load, [planNutritionSignature(items)]);

  return {
    view: data ? planNutritionView(data, targets) : null,
    loading,
    error,
    reload,
  };
}
