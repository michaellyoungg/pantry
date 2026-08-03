import {
  formatNutrientAmount,
  HEADLINE_NUTRIENTS,
  NUTRITION_COVERAGE_THRESHOLD,
  unresolvedItems,
} from "@pantry/core";
import type { NutritionEstimate } from "@pantry/types";

// What the *recipe* panel may show. The plan rollup's equivalent lives in
// @pantry/core (summarizeNutrition) because a second client needs it; this one
// stays here only because per-serving display is specific to a recipe page. The
// threshold, the headline list and the number formatting are shared, so a
// recipe and a day can never disagree about whether a figure is showable.

interface NutritionRow {
  id: string;
  label: string;
  /** The whole-recipe amount. */
  total: string;
  /** The per-serving amount, absent when the recipe carries no yield. */
  perServing?: string;
}

export type NutritionDisplay =
  /** Nothing to estimate — a recipe with no ingredients. */
  | { kind: "empty" }
  /** Too little of the recipe resolved to show a number honestly. */
  | { kind: "unavailable"; missing: string[]; coveragePercent: number }
  | {
      kind: "estimate";
      rows: NutritionRow[];
      coveragePercent: number;
      missing: string[];
      /** 0 when the recipe's yield is unknown; rows then carry totals only. */
      servings: number;
    };

/**
 * Decides what the recipe panel may show. Pure, so the coverage rule — the part
 * that decides whether the user sees a number at all — is tested directly rather
 * than through the DOM.
 */
export function nutritionDisplay(estimate: NutritionEstimate): NutritionDisplay {
  if (estimate.coverage.totalCount === 0) return { kind: "empty" };

  const missing = unresolvedItems(estimate);
  const coveragePercent = Math.round(estimate.coverage.resolvedMassFraction * 100);

  if (estimate.coverage.resolvedMassFraction < NUTRITION_COVERAGE_THRESHOLD) {
    return { kind: "unavailable", missing, coveragePercent };
  }

  // A yield of 0 means unknown (BL-0035): the server omits perServing entirely
  // rather than dividing by a guess, and so do we.
  const servings = estimate.perServing ? estimate.servings : 0;

  const rows = HEADLINE_NUTRIENTS.flatMap(({ id, label }) => {
    const amount = estimate.nutrients[id];
    if (!amount) return [];
    const each = estimate.perServing?.[id];
    return [
      {
        id,
        label,
        total: formatNutrientAmount(amount),
        perServing: each && formatNutrientAmount(each),
      },
    ];
  });
  if (rows.length === 0) return { kind: "unavailable", missing, coveragePercent };

  return { kind: "estimate", rows, coveragePercent, missing, servings };
}
