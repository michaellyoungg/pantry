import type { NutrientAmount, NutritionEstimate } from "@pantry/types";

// The vocabulary every nutrition surface shares: which nutrients lead, how an
// amount is written, and the coverage line below which a figure is suppressed
// rather than shown. One recipe, one day and one week must agree on all three —
// a recipe panel saying "not enough identified" beside a day total confidently
// stating 2,400 kcal would be the app arguing with itself.

/**
 * Below this share of the food's mass we suppress the figures entirely and name
 * what is missing instead.
 *
 * The design is explicit that a bare number is never acceptable at low coverage:
 * an estimate that silently reports 60% of a plan as though it were the whole
 * thing is worse than one that admits it does not know — especially once goal
 * tracking (BL-0038) consumes these numbers.
 */
export const NUTRITION_COVERAGE_THRESHOLD = 0.8;

/** A nutrient this UI can name, and the unit its amounts are written in. */
export interface NutrientMeta {
  id: string;
  label: string;
  unit: string;
}

/**
 * The nutrients the UI surfaces, in display order. Presentation only: the
 * estimate carries whatever FDC returned, so surfacing another nutrient is a
 * one-line change here and nothing else.
 *
 * `unit` is carried here as well as on each `NutrientAmount` because a goal
 * (BL-0038) has to be written and labelled before any estimate exists — there is
 * no measured amount to read a unit off when the user is still typing the number.
 */
export const HEADLINE_NUTRIENTS: readonly NutrientMeta[] = [
  { id: "1008", label: "Calories", unit: "kcal" },
  { id: "1003", label: "Protein", unit: "g" },
  { id: "1005", label: "Carbs", unit: "g" },
  { id: "1004", label: "Fat", unit: "g" },
  { id: "1258", label: "Saturated fat", unit: "g" },
  { id: "1079", label: "Fiber", unit: "g" },
  { id: "1093", label: "Sodium", unit: "mg" },
  { id: "1253", label: "Cholesterol", unit: "mg" },
];

const BY_ID = new Map(HEADLINE_NUTRIENTS.map((n) => [n.id, n]));

/** Label and unit for a nutrient id, or undefined if we do not surface it. */
export function nutrientMeta(nutrientId: string): NutrientMeta | undefined {
  return BY_ID.get(nutrientId);
}

/** One rendered nutrient: a label and an already-formatted amount. */
export interface NutrientRow {
  id: string;
  label: string;
  value: string;
}

/** Renders one amount at a precision appropriate to its unit. */
export function formatNutrientAmount({ amount, unit }: NutrientAmount): string {
  // Grams of protein deserve a decimal; milligrams of sodium and whole calories
  // do not, and showing "1594.772 mg" reads as false precision on an estimate.
  const decimals = unit === "g" ? 1 : 0;
  return `${amount.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

/**
 * The headline nutrients present in a vector, formatted, optionally divided by
 * `divisor` (a day count, a serving count). A nutrient the estimate does not
 * carry is skipped rather than rendered as zero — we did not measure it.
 */
export function nutrientRows(
  vector: Record<string, NutrientAmount> | undefined,
  divisor = 1,
): NutrientRow[] {
  if (!vector || divisor <= 0) return [];
  return HEADLINE_NUTRIENTS.flatMap(({ id, label }) => {
    const amount = vector[id];
    if (!amount) return [];
    return [
      { id, label, value: formatNutrientAmount({ ...amount, amount: amount.amount / divisor }) },
    ];
  });
}

/** Ingredients that did not make it into the estimate, in order, de-duplicated. */
export function unresolvedItems(estimate: NutritionEstimate): string[] {
  return [...new Set(estimate.ingredients.filter((i) => !i.resolved).map((i) => i.item))];
}
