import type { NutrientAmount, NutritionEstimate } from "@pantry/types";

/**
 * Below this share of a recipe's mass we suppress the figures entirely and name
 * what is missing instead.
 *
 * The design is explicit that a bare number is never acceptable at low coverage:
 * an estimate that silently reports 60% of a recipe as though it were the whole
 * thing is worse than one that admits it does not know — especially once goal
 * tracking (BL-0038) consumes these numbers.
 */
export const COVERAGE_THRESHOLD = 0.8;

/**
 * The nutrients the first UI surfaces, in display order: energy, macros, and the
 * few the stated scenarios need. This list is presentation only — the estimate
 * itself carries whatever FDC returned, so surfacing another nutrient is a
 * one-line change here and nothing else.
 */
const HEADLINE_NUTRIENTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "1008", label: "Calories" },
  { id: "1003", label: "Protein" },
  { id: "1005", label: "Carbs" },
  { id: "1004", label: "Fat" },
  { id: "1258", label: "Saturated fat" },
  { id: "1079", label: "Fiber" },
  { id: "1093", label: "Sodium" },
  { id: "1253", label: "Cholesterol" },
];

interface NutritionRow {
  id: string;
  label: string;
  value: string;
}

export type NutritionDisplay =
  /** Nothing to estimate — a recipe with no ingredients. */
  | { kind: "empty" }
  /** Too little of the recipe resolved to show a number honestly. */
  | { kind: "unavailable"; missing: string[]; coveragePercent: number }
  | { kind: "estimate"; rows: NutritionRow[]; coveragePercent: number; missing: string[] };

/** Ingredients that did not make it into the estimate, in recipe order. */
export function unresolvedItems(estimate: NutritionEstimate): string[] {
  return estimate.ingredients.filter((i) => !i.resolved).map((i) => i.item);
}

/** Renders one amount at a precision appropriate to its unit. */
export function formatAmount({ amount, unit }: NutrientAmount): string {
  // Grams of protein deserve a decimal; milligrams of sodium and whole calories
  // do not, and showing "1594.772 mg" reads as false precision on an estimate.
  const decimals = unit === "g" ? 1 : 0;
  return `${amount.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

/**
 * Decides what the recipe panel may show. Pure, so the coverage rule — the part
 * that decides whether the user sees a number at all — is tested directly rather
 * than through the DOM.
 */
export function nutritionDisplay(estimate: NutritionEstimate): NutritionDisplay {
  if (estimate.coverage.totalCount === 0) return { kind: "empty" };

  const missing = unresolvedItems(estimate);
  const coveragePercent = Math.round(estimate.coverage.resolvedMassFraction * 100);

  if (estimate.coverage.resolvedMassFraction < COVERAGE_THRESHOLD) {
    return { kind: "unavailable", missing, coveragePercent };
  }

  const rows = HEADLINE_NUTRIENTS.flatMap(({ id, label }) => {
    const amount = estimate.nutrients[id];
    return amount ? [{ id, label, value: formatAmount(amount) }] : [];
  });
  if (rows.length === 0) return { kind: "unavailable", missing, coveragePercent };

  return { kind: "estimate", rows, coveragePercent, missing };
}
