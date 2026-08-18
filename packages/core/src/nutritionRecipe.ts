import type {
  NutrientAmount,
  NutritionEstimate,
  NutritionTarget,
  NutritionTargetEvaluation,
} from "@pantry/types";
import { HEADLINE_NUTRIENTS, NUTRITION_COVERAGE_THRESHOLD, unresolvedItems } from "./nutrition";
import { type NutritionFactsRow, nutritionFactsLabel } from "./nutritionFacts";
import { type GoalVerdict, goalSummary, goalVerdict } from "./nutritionGoals";
import { evaluateTargets } from "./nutritionTargets";

/**
 * What the nutrition surface for **one recipe** may show (BL-0036, BL-0038,
 * BL-0049).
 *
 * The plan's equivalent is `nutritionRollup.ts`; this is the per-recipe half,
 * and the two share the coverage rule, the headline list and the number
 * formatting from `nutrition.ts` so a recipe and a day can never disagree about
 * whether a figure is showable.
 *
 * It lived in `apps/web/src/lib` until BL-0065 ported the surface to native.
 * Everything that could be got *wrong* — whether a number may be shown at all,
 * what the panel is a panel *of*, and whether the recipe meets a goal — is
 * decided here, once, and tested without rendering anything.
 */

/**
 * Whether the estimate carries any nutrient this UI names.
 *
 * An estimate can clear the coverage bar and still have nothing to print: a
 * resolved food with no nutrient data at all. That is "we could not estimate
 * this", not a plate of zeroes, so it takes the same route as low coverage.
 */
function hasHeadlineNutrient(nutrients: Record<string, NutrientAmount>): boolean {
  return HEADLINE_NUTRIENTS.some(({ id }) => nutrients[id] !== undefined);
}

/** "4 servings per recipe" — a count, which is all we know. */
function servingsLabel(servings: number): string {
  return `${servings} ${servings === 1 ? "serving" : "servings"} per recipe`;
}

/**
 * How one recipe sits against the user's **per-meal** goals (BL-0038).
 *
 * Judged against the estimate's per-serving vector: a pot holding 160 mg of
 * cholesterol that serves four is a 40 mg meal, and judging the pot would
 * condemn a recipe nobody eats in one sitting. Which is exactly why a recipe
 * with no yield gets no verdict — BL-0035 leaves `servings` optional and the
 * server omits `perServing` rather than dividing by a guess, so treating
 * "serves unknown" as "serves one" would re-introduce the guess at the point it
 * does the most damage.
 */
export type GoalFit =
  /** No per-meal goal is set, so there is nothing to say. */
  | { kind: "no-goals" }
  /** Goals are set, but the recipe carries no yield to judge one serving by. */
  | { kind: "no-servings" }
  | { kind: "verdict"; verdict: GoalVerdict; evaluations: NutritionTargetEvaluation[] };

export function recipeGoalFit(
  estimate: NutritionEstimate,
  targets: readonly NutritionTarget[],
): GoalFit {
  const mealTargets = targets.filter((t) => t.active && t.period === "meal");
  if (mealTargets.length === 0) return { kind: "no-goals" };
  if (!estimate.perServing) return { kind: "no-servings" };

  const evaluations = evaluateTargets(
    mealTargets,
    { nutrients: estimate.perServing, coverage: estimate.coverage },
    "meal",
  );
  return { kind: "verdict", verdict: goalVerdict(goalSummary(evaluations)), evaluations };
}

/** Everything a recipe's nutrition surface renders, decided in one place. */
export type RecipeNutritionView =
  /** Nothing to estimate — a recipe with no ingredients. */
  | { kind: "empty" }
  /** Too little of the recipe resolved to show a number honestly. */
  | { kind: "unavailable"; coveragePercent: number; missing: string[]; goalFit: GoalFit }
  | {
      kind: "estimate";
      /** The Nutrition Facts rows, per serving where the recipe has a yield. */
      rows: NutritionFactsRow[];
      /** What one column of figures covers: "4 servings per recipe", "Entire recipe". */
      servingsLabel: string;
      coveragePercent: number;
      missing: string[];
      goalFit: GoalFit;
    };

/**
 * Reads an estimate into what a client may draw.
 *
 * Per serving is the number a cook actually wants, so it leads when the recipe
 * has a yield. Without one the whole-recipe total is the only honest figure and
 * stands alone — and the personal column goes with it, because a `meal` target
 * is written against one serving and scoring it against a whole recipe would
 * report a four-serving casserole as four times over the goal.
 *
 * The server's own `perServing` is consulted rather than dividing `nutrients`
 * here. It is absent exactly when the yield is unknown, which is what makes
 * "never divide by a guess" structural instead of a rule each view has to
 * remember.
 */
export function recipeNutritionView(
  estimate: NutritionEstimate,
  targets: readonly NutritionTarget[] = [],
): RecipeNutritionView {
  if (estimate.coverage.totalCount === 0) return { kind: "empty" };

  const missing = unresolvedItems(estimate);
  const coveragePercent = Math.round(estimate.coverage.resolvedMassFraction * 100);
  // Goals still get an answer at low coverage — "can't tell" — because the case
  // a user most needs told about is the one where we could not measure.
  const goalFit = recipeGoalFit(estimate, targets);

  if (
    estimate.coverage.resolvedMassFraction < NUTRITION_COVERAGE_THRESHOLD ||
    !hasHeadlineNutrient(estimate.nutrients)
  ) {
    return { kind: "unavailable", coveragePercent, missing, goalFit };
  }

  // A yield of 0 means unknown (BL-0035): the server omits `perServing` rather
  // than dividing by a guess, and so do we.
  const perServing = estimate.servings > 0 ? estimate.perServing : undefined;

  return {
    kind: "estimate",
    rows: nutritionFactsLabel(perServing ?? estimate.nutrients, {
      targets,
      period: perServing ? "meal" : undefined,
    }),
    servingsLabel: perServing ? servingsLabel(estimate.servings) : "Entire recipe",
    coveragePercent,
    missing,
    goalFit,
  };
}
