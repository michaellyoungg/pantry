import type { NutritionEstimate } from "@pantry/types";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { rows: [] as Array<Record<string, unknown>> } }));

vi.mock("convex/react", () => ({ useQuery: () => state.rows }));
vi.mock("@pantry/convex/api", () => ({
  api: { nutritionTargets: { list: "nutritionTargets:list" } },
}));

import { RecipeGoalFit } from "./RecipeGoalFit";

const mealCap = {
  _id: "t1",
  _creationTime: 0,
  userId: "u",
  nutrientId: "1253",
  operator: "<=",
  value: 100,
  period: "meal",
  active: true,
};

const mealFloor = { ...mealCap, _id: "t2", nutrientId: "1003", operator: ">=", value: 30 };

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

beforeEach(() => {
  state.rows = [];
});
afterEach(() => vi.restoreAllMocks());

describe("RecipeGoalFit", () => {
  it("renders nothing when the user has no per-meal goals", () => {
    state.rows = [{ ...mealCap, period: "day" }];
    const { container } = render(<RecipeGoalFit estimate={estimate()} />);
    expect(container.textContent).toBe("");
  });

  it("says a recipe fits when every per-meal goal is met", () => {
    state.rows = [mealCap];
    render(<RecipeGoalFit estimate={estimate()} />);
    expect(screen.getByText(/fits your goals/i)).toBeTruthy();
  });

  it("says a recipe does not fit when a per-meal cap is exceeded", () => {
    state.rows = [{ ...mealCap, value: 10 }];
    render(<RecipeGoalFit estimate={estimate()} />);
    expect(screen.getByText(/doesn't fit/i)).toBeTruthy();
  });

  it("judges a serving, not the whole recipe", () => {
    // 160 mg in the pot, 40 mg on the plate. A per-meal cap of 100 mg is met —
    // judging the whole recipe would wrongly condemn a recipe that serves four.
    state.rows = [mealCap];
    render(<RecipeGoalFit estimate={estimate()} />);
    expect(screen.getByText(/fits your goals/i)).toBeTruthy();
  });

  it("cannot judge a per-meal goal on a recipe with no yield", () => {
    // BL-0035 leaves servings optional and the server omits perServing rather
    // than dividing by a guess. "Serves unknown" must not silently become
    // "serves one" — that would report a family pot as a single meal.
    state.rows = [mealCap];
    const noYield = estimate({ perServing: undefined, servings: 0 });
    render(<RecipeGoalFit estimate={noYield} />);
    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/serving count|how many it serves/i)).toBeTruthy();
  });

  it("cannot judge a recipe whose ingredients were not identified", () => {
    state.rows = [mealCap];
    const thin = estimate({
      coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 5 },
    });
    render(<RecipeGoalFit estimate={thin} />);
    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/can't tell/i)).toBeTruthy();
  });

  it("never claims a fit while any goal is unmeasurable", () => {
    // One met goal plus one unmeasurable goal is not a fit. Reporting it as one
    // would let a nutrient we failed to measure pass as within limits.
    state.rows = [mealCap, { ...mealFloor, nutrientId: "1079" }];
    render(<RecipeGoalFit estimate={estimate()} />);
    expect(screen.queryByText(/fits your goals/i)).toBeNull();
    expect(screen.getByText(/can't tell/i)).toBeTruthy();
  });

  it("shows the goals behind the verdict", () => {
    state.rows = [mealCap];
    render(<RecipeGoalFit estimate={estimate()} />);
    expect(screen.getByText(/Cholesterol ≤ 100 mg/)).toBeTruthy();
  });
});
