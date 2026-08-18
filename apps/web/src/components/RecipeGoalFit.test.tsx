import { recipeGoalFit } from "@pantry/core";
import type { NutritionEstimate, NutritionTarget } from "@pantry/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecipeGoalFit } from "./RecipeGoalFit";

/**
 * The verdict itself is `recipeGoalFit` in `@pantry/core`, tested there without
 * a DOM. These render the real thing rather than a hand-built prop, so what is
 * asserted is still "this recipe, these goals, this sentence" — the seam the
 * two clients share is exercised, not stubbed around.
 */

const mealCap: NutritionTarget = {
  nutrientId: "1253",
  operator: "<=",
  value: 100,
  period: "meal",
  active: true,
};

const fiberFloor: NutritionTarget = { ...mealCap, nutrientId: "1079", operator: ">=", value: 30 };

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1253": { nutrientId: "1253", amount: 160, unit: "mg" },
      "1003": { nutrientId: "1003", amount: 80, unit: "g" },
    },
    perServing: {
      "1253": { nutrientId: "1253", amount: 40, unit: "mg" },
      "1003": { nutrientId: "1003", amount: 20, unit: "g" },
    },
    servings: 4,
    coverage: { resolvedMassFraction: 1, resolvedCount: 5, totalCount: 5 },
    ingredients: [],
    estimatedAt: "2026-08-03T00:00:00Z",
    ...over,
  };
}

function verdictFor(targets: NutritionTarget[], over: Partial<NutritionEstimate> = {}) {
  return render(<RecipeGoalFit fit={recipeGoalFit(estimate(over), targets)} />);
}

describe("RecipeGoalFit", () => {
  it("renders nothing when the user has no per-meal goals", () => {
    const { container } = verdictFor([{ ...mealCap, period: "day" }]);

    expect(container.textContent).toBe("");
  });

  // 160 mg in the pot, 40 mg on the plate. A per-meal cap of 100 mg is met —
  // judging the whole recipe would wrongly condemn a recipe that serves four.
  it("says a recipe fits when every per-meal goal is met by one serving", () => {
    verdictFor([mealCap]);

    expect(screen.getByText(/fits your goals/i)).toBeTruthy();
  });

  it("says a recipe does not fit when a per-meal cap is exceeded", () => {
    verdictFor([{ ...mealCap, value: 10 }]);

    expect(screen.getByText(/doesn't fit/i)).toBeTruthy();
  });

  it("asks for a serving count rather than judging a recipe with no yield", () => {
    verdictFor([mealCap], { perServing: undefined, servings: 0 });

    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/serving count/i)).toBeTruthy();
  });

  it("cannot judge a recipe whose ingredients were not identified", () => {
    verdictFor([mealCap], {
      coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 5 },
    });

    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/can't tell/i)).toBeTruthy();
  });

  // One met goal plus one unmeasurable goal is not a fit. Reporting it as one
  // would let a nutrient we failed to measure pass as within limits.
  it("never claims a fit while any goal is unmeasurable", () => {
    verdictFor([mealCap, fiberFloor]);

    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/can't tell/i)).toBeTruthy();
  });

  it("shows the goals behind the verdict", () => {
    verdictFor([mealCap]);

    expect(screen.getByText(/Cholesterol ≤ 100 mg/)).toBeTruthy();
  });
});
