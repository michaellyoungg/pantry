import { type GoalFit, GOAL_VERDICT_LABELS, type GoalVerdict } from "@pantry/core";
import { GoalStatus } from "./GoalStatus";

/**
 * "Fits your goals" for one recipe (BL-0038).
 *
 * The verdict itself is `recipeGoalFit` in `@pantry/core`: it uses the `meal`
 * period against the estimate's **per-serving** vector, because a pot holding
 * 160 mg of cholesterol that serves four is a 40 mg meal, and judging the pot
 * would condemn a recipe nobody eats in one sitting. A recipe with no yield
 * therefore gets no verdict at all — treating "serves unknown" as "serves one"
 * would quietly re-introduce the guess the server refused to make.
 *
 * What is left here is the paint.
 */

const VERDICT_CLASS: Record<GoalVerdict, string> = {
  fits: "text-primary",
  unknown: "text-muted",
  misses: "text-danger",
};

export function RecipeGoalFit({ fit }: { fit: GoalFit }) {
  if (fit.kind === "no-goals") return null;

  if (fit.kind === "no-servings") {
    return (
      <p className="text-xs text-muted">
        Add a serving count to this recipe to check it against your per-meal goals.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <p className={`text-sm font-medium ${VERDICT_CLASS[fit.verdict]}`}>
        {GOAL_VERDICT_LABELS[fit.verdict]}
      </p>
      <GoalStatus evaluations={fit.evaluations} />
    </div>
  );
}
