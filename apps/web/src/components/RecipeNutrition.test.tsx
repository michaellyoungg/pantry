import type { NutritionEstimate } from "@pantry/types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
}));

// useTracedAction wraps convex/react's useAction (BL-0027); mocking at that
// boundary keeps the test about the panel, not about tracing.
// The panel also renders the per-meal goal verdict (BL-0038), which reads the
// user's targets. No targets here, so it renders nothing and these cases stay
// about the numbers; the verdict has its own tests in RecipeGoalFit.test.tsx.
vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useQuery: () => [],
}));

import { RecipeNutrition } from "./RecipeNutrition";

function estimate(overrides: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 950, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 30.5, unit: "g" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 2, totalCount: 2 },
    ingredients: [
      { item: "flour", grams: 125, resolved: true },
      { item: "eggs", grams: 100, resolved: true },
    ],
    estimatedAt: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

describe("RecipeNutrition", () => {
  beforeEach(() => {
    actionMock.mockReset();
  });

  it("shows whole-recipe totals when the recipe has no yield", async () => {
    actionMock.mockResolvedValue(estimate());
    render(<RecipeNutrition recipeId="r1" />);

    expect(await screen.findByText("950 kcal")).toBeTruthy();
    expect(screen.getByText("30.5 g")).toBeTruthy();
    expect(screen.getByText(/Estimated · whole recipe/)).toBeTruthy();
    expect(actionMock).toHaveBeenCalledWith({ id: "r1" });
  });

  // With a yield (BL-0035) the per-serving figure leads and the total follows.
  it("leads with per-serving amounts when the recipe has a yield", async () => {
    actionMock.mockResolvedValue(
      estimate({
        servings: 4,
        perServing: {
          "1008": { nutrientId: "1008", amount: 237.5, unit: "kcal" },
          "1003": { nutrientId: "1003", amount: 7.625, unit: "g" },
        },
      }),
    );
    render(<RecipeNutrition recipeId="r1" />);

    expect(await screen.findByText("238 kcal")).toBeTruthy();
    expect(screen.getByText(/Estimated · per serving of 4/)).toBeTruthy();
    expect(screen.getByText("(950 kcal total)")).toBeTruthy();
  });

  // The contract that matters: a low-coverage recipe must not show a number.
  it("suppresses the figures and names the gaps at low coverage", async () => {
    actionMock.mockResolvedValue(
      estimate({
        coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 3 },
        ingredients: [
          { item: "flour", grams: 125, resolved: true },
          { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
          { item: "tempeh", grams: 200, resolved: false, reason: "no nutrition data" },
        ],
      }),
    );
    render(<RecipeNutrition recipeId="r1" />);

    expect(await screen.findByText(/Not enough of this recipe/)).toBeTruthy();
    expect(screen.getByText("gochujang, tempeh")).toBeTruthy();
    expect(screen.queryByText("950 kcal")).toBeNull();
  });

  it("names skipped ingredients even when coverage is good", async () => {
    actionMock.mockResolvedValue(
      estimate({
        coverage: { resolvedMassFraction: 0.98, resolvedCount: 2, totalCount: 3 },
        ingredients: [
          { item: "flour", grams: 125, resolved: true },
          { item: "eggs", grams: 100, resolved: true },
          { item: "salt", grams: null, resolved: false, reason: "trace measure" },
        ],
      }),
    );
    render(<RecipeNutrition recipeId="r1" />);

    expect(await screen.findByText("950 kcal")).toBeTruthy();
    expect(screen.getByText("salt")).toBeTruthy();
  });

  it("offers a retry when the estimate fails", async () => {
    actionMock.mockRejectedValue(new Error("recipe-service unavailable"));
    render(<RecipeNutrition recipeId="r1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByText(/recipe-service unavailable/)).toBeTruthy();
  });

  it("says so for a recipe with no ingredients", async () => {
    actionMock.mockResolvedValue(
      estimate({
        nutrients: {},
        ingredients: [],
        coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
      }),
    );
    render(<RecipeNutrition recipeId="r1" />);

    expect(await screen.findByText(/Add ingredients/)).toBeTruthy();
  });
});
