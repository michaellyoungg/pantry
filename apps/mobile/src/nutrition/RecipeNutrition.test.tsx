import type { NutritionEstimate } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * Estimated nutrition on the recipe screen.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockEstimate = jest.fn(async () => ({}) as unknown);
const mockTargets = { rows: [] as Array<Record<string, unknown>> | undefined };

jest.mock("convex/react", () => ({
  useAction: () => mockEstimate,
  useQuery: () => mockTargets.rows,
}));

import { RecipeNutrition } from "./RecipeNutrition";

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 2080, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 120, unit: "g" },
      "1093": { nutrientId: "1093", amount: 3200, unit: "mg" },
    },
    perServing: {
      "1008": { nutrientId: "1008", amount: 520, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 30, unit: "g" },
      "1093": { nutrientId: "1093", amount: 800, unit: "mg" },
    },
    servings: 4,
    coverage: { resolvedMassFraction: 1, resolvedCount: 4, totalCount: 4 },
    ingredients: [{ item: "chicken", grams: 500, resolved: true }],
    estimatedAt: "2026-08-17T12:00:00Z",
    ...over,
  };
}

const sodiumCap = {
  _id: "t1",
  _creationTime: 0,
  userId: "u1",
  nutrientId: "1093",
  operator: "<=",
  value: 1000,
  period: "meal",
  active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTargets.rows = [];
  mockEstimate.mockResolvedValue(estimate());
});

async function mounted() {
  await render(<RecipeNutrition recipeId="r1" />);
  await waitFor(() => expect(mockEstimate).toHaveBeenCalled());
}

describe("the recipe's nutrition", () => {
  it("keeps the label behind a tap, so the method is not buried under it", async () => {
    await mounted();

    expect(screen.getByTestId("recipes.nutrition-toggle")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.nutrition-facts")).toBeNull();

    await fireEvent.press(screen.getByTestId("recipes.nutrition-toggle"));

    expect(screen.getByTestId("recipes.nutrition-facts")).toBeOnTheScreen();
  });

  // Per serving is the number a cook wants, and the server is what divides.
  it("labels the panel as one serving when the recipe has a yield", async () => {
    await mounted();
    await fireEvent.press(screen.getByTestId("recipes.nutrition-toggle"));

    expect(screen.getByTestId("recipes.nutrition-servings")).toHaveTextContent(
      "4 servings per recipe",
    );
    expect(screen.getByText("520 kcal")).toBeOnTheScreen();
  });

  it("labels the panel as the whole recipe when there is no yield", async () => {
    mockEstimate.mockResolvedValue(estimate({ perServing: undefined, servings: 0 }));

    await mounted();
    await fireEvent.press(screen.getByTestId("recipes.nutrition-toggle"));

    expect(screen.getByTestId("recipes.nutrition-servings")).toHaveTextContent("Entire recipe");
    expect(screen.getByText("2080 kcal")).toBeOnTheScreen();
  });

  it("says it is estimating rather than saying there is no nutrition", async () => {
    // Never settles, which is the only way to hold the screen in the state a
    // slow round trip puts it in.
    mockEstimate.mockReturnValue(new Promise(() => {}));

    await render(<RecipeNutrition recipeId="r1" />);

    expect(screen.getByTestId("recipes.nutrition-loading")).toBeOnTheScreen();
  });

  it("offers a retry when the estimate fails", async () => {
    mockEstimate.mockRejectedValue(new Error("recipe-service unreachable"));

    await mounted();

    expect(await screen.findByText("recipe-service unreachable")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("recipes.nutrition-retry"));
    await waitFor(() => expect(mockEstimate).toHaveBeenCalledTimes(2));
  });

  // The whole point of the coverage rule: no figures, and the gap named.
  it("suppresses the figures below the coverage threshold and names the gaps", async () => {
    mockEstimate.mockResolvedValue(
      estimate({
        coverage: { resolvedMassFraction: 0.31, resolvedCount: 1, totalCount: 4 },
        ingredients: [
          { item: "chicken", grams: 500, resolved: true },
          { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
        ],
      }),
    );

    await mounted();

    expect(await screen.findByTestId("recipes.nutrition-unavailable")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.nutrition-toggle")).toBeNull();
    expect(screen.getByText(/gochujang/)).toBeOnTheScreen();
  });

  it("names what was not counted even when the figures are good enough to show", async () => {
    mockEstimate.mockResolvedValue(
      estimate({
        coverage: { resolvedMassFraction: 0.95, resolvedCount: 3, totalCount: 4 },
        ingredients: [
          { item: "chicken", grams: 500, resolved: true },
          { item: "salt", grams: null, resolved: false, reason: "trace measure" },
        ],
      }),
    );

    await mounted();

    expect(await screen.findByTestId("recipes.nutrition-missing")).toHaveTextContent(
      "Not counted: salt",
    );
  });
});

describe("the goal verdict", () => {
  it("stays away when the user has no per-meal goal", async () => {
    await mounted();

    expect(screen.queryByTestId("recipes.goal-fit")).toBeNull();
  });

  // 3200 mg in the pot, 800 mg on the plate, against a 1000 mg per-meal cap.
  // Judging the pot would condemn a recipe nobody eats in one sitting.
  it("judges one serving, and leads with the verdict", async () => {
    mockTargets.rows = [sodiumCap];

    await mounted();

    expect(await screen.findByTestId("recipes.goal-verdict")).toHaveTextContent("Fits your goals");
  });

  it("says a recipe does not fit when a per-meal cap is broken", async () => {
    mockTargets.rows = [{ ...sodiumCap, value: 500 }];

    await mounted();

    expect(await screen.findByTestId("recipes.goal-verdict")).toHaveTextContent(
      "Doesn't fit your goals",
    );
  });

  // "Serves unknown" must not silently become "serves one".
  it("asks for a serving count rather than judging a recipe with no yield", async () => {
    mockTargets.rows = [sodiumCap];
    mockEstimate.mockResolvedValue(estimate({ perServing: undefined, servings: 0 }));

    await mounted();

    expect(await screen.findByTestId("recipes.goal-fit-no-servings")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.goal-verdict")).toBeNull();
  });

  // The case a user most needs told about is the one where we could not measure.
  it("still answers the goals when coverage is too low for a figure", async () => {
    mockTargets.rows = [sodiumCap];
    mockEstimate.mockResolvedValue(
      estimate({ coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 4 } }),
    );

    await mounted();

    expect(await screen.findByTestId("recipes.goal-verdict")).toHaveTextContent(
      "Can't tell if this fits",
    );
  });
});
