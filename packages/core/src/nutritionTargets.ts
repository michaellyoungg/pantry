import type {
  NutrientAmount,
  NutritionCoverage,
  NutritionTarget,
  NutritionTargetEvaluation,
  NutritionTargetPeriod,
  NutritionTargetStatus,
  NutritionUnknownReason,
} from "@pantry/types";

/**
 * Evaluating nutrition goals (BL-0038).
 *
 * One shape — `{nutrientId, operator, value, period}` — and one function serve
 * every goal in the product: a macro target, a cholesterol cap, a calorie
 * ceiling, and the diets nobody has asked for yet. There is no `lowCarbMode`
 * boolean and no per-diet branch here; a preset is a bundle of rows (see
 * `dietPresets.ts`), so a new diet is a data edit.
 *
 * Pure by construction: it depends on nothing but its arguments, which is why it
 * lives in the headless layer and is shared by every client.
 */

/** A nutrient this UI can set a goal on and label. */
export interface NutrientMeta {
  id: string;
  label: string;
  unit: string;
}

/**
 * The nutrients we surface, in display order: energy, macros, and the few the
 * stated scenarios need. Ids are FDC nutrient numbers — we do not invent a
 * parallel taxonomy — and the estimate itself carries whatever FDC returned, so
 * surfacing another nutrient is one entry here and nothing else.
 */
export const NUTRIENT_CATALOG: readonly NutrientMeta[] = [
  { id: "1008", label: "Calories", unit: "kcal" },
  { id: "1003", label: "Protein", unit: "g" },
  { id: "1005", label: "Carbs", unit: "g" },
  { id: "1004", label: "Fat", unit: "g" },
  { id: "1258", label: "Saturated fat", unit: "g" },
  { id: "1079", label: "Fiber", unit: "g" },
  { id: "1093", label: "Sodium", unit: "mg" },
  { id: "1253", label: "Cholesterol", unit: "mg" },
];

const BY_ID = new Map(NUTRIENT_CATALOG.map((n) => [n.id, n]));

/** Label and unit for a nutrient id, or undefined if we do not surface it. */
export function nutrientMeta(nutrientId: string): NutrientMeta | undefined {
  return BY_ID.get(nutrientId);
}

/**
 * Below this share of resolved mass we refuse to answer.
 *
 * The threshold is the whole safety story. An estimate covering 40% of a
 * recipe's mass reports the other 60% as zero, and zero passes every cap: the
 * user would be told their low-cholesterol day is fine *because* we failed to
 * identify the food. Suppressing the verdict is the only honest option, and it
 * is why `unknown` is a first-class status rather than an error case.
 */
export const COVERAGE_THRESHOLD = 0.8;

/**
 * How close an `==` target has to be to count as met, as a fraction of the
 * target value.
 *
 * These are estimates of as-purchased ingredients, so exact equality is
 * unreachable — a strict `===` would report every "hit 2,000 calories" goal as
 * under or over forever. `==` therefore means "about this much", with the band
 * stated rather than hidden.
 */
export const EQUALITY_BAND = 0.02;

/**
 * Tolerance for the ordered comparisons, relative to the target value.
 *
 * A day's total is a sum of many floats, so three perfect 50 g servings can land
 * at 149.99999999999997. Without this, a goal the user exactly hit reads as
 * missed.
 */
const COMPARISON_EPSILON = 1e-9;

/**
 * The minimum an estimate has to look like to be evaluated. `NutritionEstimate`
 * satisfies it structurally, so a per-recipe estimate, a day rollup and a week
 * rollup all pass through unchanged — the evaluator never learns which is which.
 */
export interface NutritionVector {
  nutrients: Record<string, NutrientAmount>;
  coverage: NutritionCoverage;
}

function unknown(
  target: NutritionTarget,
  reason: NutritionUnknownReason,
  coverage: number | null,
): NutritionTargetEvaluation {
  return {
    target,
    actual: null,
    unit: nutrientMeta(target.nutrientId)?.unit ?? null,
    status: "unknown",
    reason,
    coverage,
  };
}

function compare(
  operator: NutritionTarget["operator"],
  actual: number,
  value: number,
): NutritionTargetStatus {
  if (operator === "==") {
    const band = Math.abs(value) * EQUALITY_BAND;
    if (Math.abs(actual - value) <= band) return "met";
    return actual < value ? "under" : "over";
  }
  const slack = Math.max(Math.abs(value), 1) * COMPARISON_EPSILON;
  if (operator === ">=") return actual >= value - slack ? "met" : "under";
  return actual <= value + slack ? "met" : "over";
}

function evaluateOne(target: NutritionTarget, vector: NutritionVector): NutritionTargetEvaluation {
  const { coverage } = vector;

  // Nothing was planned, or nothing resolved at all. Either way there is no
  // measurement to judge — an empty plate is not evidence of a met goal.
  if (coverage.totalCount === 0) return unknown(target, "no-estimate", null);

  if (coverage.resolvedMassFraction < COVERAGE_THRESHOLD) {
    return unknown(target, "low-coverage", coverage.resolvedMassFraction);
  }

  // Coverage measures *mass* resolved, not nutrient completeness. A food matched
  // without a cholesterol figure is not a food with no cholesterol, so an absent
  // nutrient stays unanswered rather than passing every cap at zero.
  const amount = vector.nutrients[target.nutrientId];
  if (!amount) {
    return unknown(target, "nutrient-missing", coverage.resolvedMassFraction);
  }

  return {
    target,
    actual: amount.amount,
    unit: amount.unit || (nutrientMeta(target.nutrientId)?.unit ?? null),
    status: compare(target.operator, amount.amount, target.value),
    coverage: coverage.resolvedMassFraction,
  };
}

/**
 * Evaluate the `period`'s active targets against one summed nutrient vector.
 *
 * `period` is a required argument rather than something the caller filters
 * beforehand: judging a week's protein goal against a single day's total is the
 * easiest possible mistake to make here, and the type system cannot catch it.
 *
 * A `null` vector — the rollup has not loaded, or failed — yields `unknown` for
 * every target rather than an empty list, so a goal never silently disappears
 * from the screen at the moment we stop being able to answer it.
 */
export function evaluateTargets(
  targets: readonly NutritionTarget[],
  vector: NutritionVector | null,
  period: NutritionTargetPeriod,
): NutritionTargetEvaluation[] {
  return targets
    .filter((t) => t.active && t.period === period)
    .map((t) => (vector ? evaluateOne(t, vector) : unknown(t, "no-estimate", null)));
}
