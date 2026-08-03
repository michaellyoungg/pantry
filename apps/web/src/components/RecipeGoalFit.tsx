import { api } from "@pantry/convex/api";
import { evaluateTargets, type NutritionVector } from "@pantry/core";
import type { NutritionEstimate, NutritionTarget } from "@pantry/types";
import { useQuery } from "convex/react";
import { goalSummary } from "../lib/nutritionGoals";
import { GoalStatus } from "./GoalStatus";

/**
 * "Fits your goals" for one recipe (BL-0038).
 *
 * Uses the `meal` period, judged against the estimate's **per-serving** vector:
 * a pot holding 160 mg of cholesterol that serves four is a 40 mg meal, and
 * judging the pot would condemn a recipe nobody eats in one sitting.
 *
 * Which is exactly why a recipe with no yield gets no verdict at all. BL-0035
 * leaves `servings` optional and the server omits `perServing` rather than
 * dividing by a guess; treating "serves unknown" as "serves one" here would
 * quietly re-introduce the guess at the point it does the most damage.
 */
export function RecipeGoalFit({ estimate }: { estimate: NutritionEstimate }) {
  const targets = (useQuery(api.nutritionTargets.list) ?? []) as NutritionTarget[];

  const mealTargets = targets.filter((t) => t.active && t.period === "meal");
  if (mealTargets.length === 0) return null;

  if (!estimate.perServing) {
    return (
      <p className="text-xs text-muted">
        Add a serving count to this recipe to check it against your per-meal goals.
      </p>
    );
  }

  const vector: NutritionVector = {
    nutrients: estimate.perServing,
    coverage: estimate.coverage,
  };
  const evaluations = evaluateTargets(mealTargets, vector, "meal");
  const summary = goalSummary(evaluations);

  // Three verdicts, and "can't tell" is a real one. A recipe with one met goal
  // and one we could not measure is not a fit — saying so would let the nutrient
  // we failed to measure pass as within limits.
  const verdict = summary.onTrack
    ? { text: "Fits your goals", className: "text-primary" }
    : summary.unknown > 0
      ? { text: "Can't tell if this fits", className: "text-muted" }
      : { text: "Doesn't fit your goals", className: "text-danger" };

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <p className={`text-sm font-medium ${verdict.className}`}>{verdict.text}</p>
      <GoalStatus evaluations={evaluations} />
    </div>
  );
}
