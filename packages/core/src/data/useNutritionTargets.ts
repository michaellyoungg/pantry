import { api } from "@pantry/convex/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

/**
 * One stored goal, as Convex returns it.
 *
 * Derived from the query rather than restated as `NutritionTarget`, which keeps
 * `_id` a branded `Id<"nutritionTargets">` — every mutation in the editor takes
 * the branded id, and a hand-written type erases it. The row satisfies
 * `NutritionTarget` structurally, so it passes straight into the evaluator.
 */
export type NutritionTargetRow = FunctionReturnType<typeof api.nutritionTargets.list>[number];

export type UseNutritionTargets = {
  /**
   * The stored goals, `[]` while the query is in flight. Every reader treats
   * "none yet" and "none set" the same way — neither draws a personal column —
   * so the absent case does not need a third value.
   */
  targets: NutritionTargetRow[];
  /** True until the first response, for a surface that must not say "no goals". */
  loading: boolean;
};

/**
 * The user's nutrition goals (BL-0038), read once.
 *
 * Four surfaces consult this list — the recipe panel, the recipe verdict, the
 * plan rollup and the plan's goal status — and each wants the same answer at
 * the same moment. One subscription named once is what stops a view on either
 * client re-deriving it; the editor's writes live in `useNutritionGoals`.
 */
export function useNutritionTargets(): UseNutritionTargets {
  const rows = useQuery(api.nutritionTargets.list);
  return { targets: rows ?? [], loading: rows === undefined };
}
