import type { PlannedItem } from "@pantry/core";
import type { NutritionEstimate } from "@pantry/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";

/**
 * The week's estimated nutrition on the planner.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockPlanNutrition = jest.fn(async () => ({}) as unknown);
const mockTargets = { rows: [] as Array<Record<string, unknown>> | undefined };

jest.mock("convex/react", () => ({
  useAction: () => mockPlanNutrition,
  useQuery: () => mockTargets.rows,
}));

import { PlanNutrition } from "./PlanNutrition";

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 2100, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 95, unit: "g" },
      "1253": { nutrientId: "1253", amount: 150, unit: "mg" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 4, totalCount: 4 },
    ingredients: [{ item: "rice", grams: 185, resolved: true }],
    estimatedAt: "2026-08-17T12:00:00Z",
    recipes: [
      {
        recipeId: "r1",
        title: "Chili",
        multiplier: 1,
        counted: true,
        coverage: { resolvedMassFraction: 1, resolvedCount: 4, totalCount: 4 },
      },
    ],
    ...over,
  };
}

const WEEK = {
  days: [
    { weekday: 0, estimate: estimate() },
    { weekday: 3, estimate: estimate() },
  ],
  week: estimate(),
};

const ITEMS: PlannedItem[] = [{ recipeId: "r1", weekday: 0 } as PlannedItem];

const dayCap = {
  _id: "t1",
  _creationTime: 0,
  userId: "u1",
  nutrientId: "1253",
  operator: "<=",
  value: 300,
  period: "day",
  active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTargets.rows = [];
  mockPlanNutrition.mockResolvedValue(WEEK);
});

async function mounted(weekday = 0) {
  await render(<PlanNutrition items={ITEMS} weekday={weekday} />);
  await waitFor(() => expect(mockPlanNutrition).toHaveBeenCalled());
}

describe("the week", () => {
  it("leads with the average day across the days that have food", async () => {
    await mounted();

    expect(await screen.findByTestId("plan.nutrition-week")).toHaveTextContent(
      /Estimated average per day · across 2 planned days/,
    );
    expect(screen.getByText("1050 kcal")).toBeOnTheScreen();
  });

  it("says it is estimating rather than saying the week is empty", async () => {
    mockPlanNutrition.mockReturnValue(new Promise(() => {}));

    await render(<PlanNutrition items={ITEMS} weekday={0} />);

    expect(screen.getByTestId("plan.nutrition-pending")).toHaveTextContent(
      "Estimating this week's nutrition…",
    );
  });

  it("asks for a dinner rather than reporting an empty week as zero", async () => {
    mockPlanNutrition.mockResolvedValue({ days: [], week: null });

    await mounted();

    expect(await screen.findByTestId("plan.nutrition-empty")).toBeOnTheScreen();
  });

  it("offers a retry when the rollup fails", async () => {
    mockPlanNutrition.mockRejectedValue(new Error("estimate failed"));

    await mounted();

    expect(await screen.findByText("estimate failed")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("plan.nutrition-retry"));
    await waitFor(() => expect(mockPlanNutrition).toHaveBeenCalledTimes(2));
  });

  // An excluded recipe is the gap a coverage percentage physically cannot
  // express: none of its food is in either side of that ratio.
  it("names a recipe it could not read at all", async () => {
    mockPlanNutrition.mockResolvedValue({
      days: [{ weekday: 0, estimate: estimate() }],
      week: estimate({
        recipes: [
          {
            recipeId: "r2",
            title: "Mystery Stew",
            multiplier: 1,
            counted: false,
            coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 3 },
          },
        ],
      }),
    });

    await mounted();

    expect(await screen.findByText(/Mystery Stew/)).toBeOnTheScreen();
  });
});

describe("the day the pager is on", () => {
  it("shows that day's total and no other day's", async () => {
    await mounted(3);

    expect(await screen.findByTestId("plan.nutrition-day")).toHaveTextContent(/^Thursday/);
    expect(screen.queryByText("Monday")).toBeNull();
  });

  it("shows nothing for a day the week has no food on", async () => {
    await mounted(5);

    await screen.findByTestId("plan.nutrition-week");
    expect(screen.queryByTestId("plan.nutrition-day")).toBeNull();
  });

  // A day is the period the Daily Value is defined against, so the day's own
  // total is the figure — no divisor.
  it("opens a Nutrition Facts panel for the day, off the day's own total", async () => {
    await mounted();

    await fireEvent.press(await screen.findByTestId("plan.nutrition-facts-toggle"));

    expect(screen.getByTestId("plan.nutrition-servings")).toHaveTextContent("Monday · whole day");
    expect(screen.getByText("2100 kcal")).toBeOnTheScreen();
  });

  // A quasi-official label over figures the rest of the app has agreed not to
  // trust is the artifact this whole track exists to prevent.
  it("offers no panel for a day it will not put a number on", async () => {
    mockPlanNutrition.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 4 },
          }),
        },
      ],
      week: estimate(),
    });

    await mounted();

    expect(await screen.findByTestId("plan.nutrition-day-total")).toHaveTextContent(
      "Not enough identified to estimate (about 20%)",
    );
    expect(screen.queryByTestId("plan.nutrition-facts-toggle")).toBeNull();
  });
});

describe("the week's goals", () => {
  it("stays away when the user has no day or week goal", async () => {
    await mounted();

    await screen.findByTestId("plan.nutrition-week");
    expect(screen.queryByTestId("plan.goals")).toBeNull();
  });

  it("judges the paged-to day against the same rollup the totals came from", async () => {
    mockTargets.rows = [dayCap];

    await mounted();

    const goals = await screen.findByTestId("plan.goals");
    expect(within(goals).getByText("Monday")).toBeOnTheScreen();
    expect(within(goals).getByTestId("plan.goal-chip.1253-day")).toHaveTextContent(
      /Cholesterol ≤ 300 mg/,
    );
    // One request, both halves. Asking twice is how they come to disagree.
    expect(mockPlanNutrition).toHaveBeenCalledTimes(1);
  });

  // Zero food identified is not zero cholesterol eaten.
  it("reports a day it could not account for as unchecked, never as under the cap", async () => {
    mockTargets.rows = [dayCap];
    mockPlanNutrition.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 4 },
          }),
        },
      ],
      week: estimate(),
    });

    await mounted();

    expect(await screen.findByTestId("plan.goal-chip.1253-day")).toHaveTextContent(
      /only 20% identified/,
    );
  });
});
