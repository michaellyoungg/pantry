import type { PlannedItem } from "@pantry/core";
import type { NutritionEstimate, NutritionRecipeCoverage } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock, goals } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  goals: { rows: [] as Array<Record<string, unknown>> },
}));

// useTracedAction wraps convex/react's useAction (BL-0027); mocking at that
// boundary keeps the test about the panel, not about tracing. useQuery feeds
// the nutrition goals this card also renders (BL-0038) — empty by default, so
// the cases below stay about the numbers.
vi.mock("convex/react", () => ({ useAction: () => actionMock, useQuery: () => goals.rows }));

import { PlanNutrition } from "./PlanNutrition";

function recipe(over: Partial<NutritionRecipeCoverage> = {}): NutritionRecipeCoverage {
  return {
    recipeId: "r1",
    title: "Pancakes",
    multiplier: 1,
    counted: true,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ...over,
  };
}

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 900, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 30, unit: "g" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ingredients: [{ item: "flour", grams: 125, resolved: true }],
    estimatedAt: "2026-08-03T12:00:00Z",
    recipes: [recipe()],
    ...over,
  };
}

const items: PlannedItem[] = [{ _id: "b1", recipeId: "r1", title: "Pancakes", weekday: 0 }];

describe("PlanNutrition", () => {
  // Block body, not a concise arrow: returning the mock from beforeEach makes
  // Vitest treat it as a teardown callback and *call* it after every test.
  beforeEach(() => {
    actionMock.mockReset();
    goals.rows = [];
  });

  it("shows the daily average, the week total and each planned day", async () => {
    actionMock.mockResolvedValue({
      days: [
        { weekday: 0, estimate: estimate() },
        { weekday: 2, estimate: estimate() },
      ],
      week: estimate({
        nutrients: { "1008": { nutrientId: "1008", amount: 1800, unit: "kcal" } },
      }),
    });

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/across 2 planned days/)).toBeTruthy();
    // 1800 kcal over the two days that had food.
    expect(screen.getByText("900 kcal")).toBeTruthy();
    expect(screen.getByText(/Week total: Calories 1800 kcal/)).toBeTruthy();
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("Wednesday")).toBeTruthy();
    expect(screen.queryByText("Tuesday")).toBeNull();
    expect(screen.getAllByText(/Calories 900 kcal · Protein 30.0 g/)).toHaveLength(2);
  });

  // The requirement this surface exists for: a day whose dinner could not be
  // read has to say so rather than report a smaller number as if it were whole.
  it("names a recipe that is missing from the totals entirely", async () => {
    actionMock.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({ recipes: [recipe(), recipe({ title: "Chili", counted: false })] }),
        },
      ],
      week: estimate({ recipes: [recipe(), recipe({ title: "Chili", counted: false })] }),
    });

    render(<PlanNutrition items={items} />);

    const notes = await screen.findAllByText(/we couldn't read/);
    expect(notes.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chili").length).toBeGreaterThan(0);
  });

  it("names a recipe that was only partly counted", async () => {
    actionMock.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            recipes: [
              recipe(),
              recipe({
                recipeId: "r2",
                title: "Curry",
                coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 4 },
              }),
            ],
          }),
        },
      ],
      week: estimate(),
    });

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/Only partly counted/)).toBeTruthy();
    expect(screen.getByText("Curry")).toBeTruthy();
  });

  it("names the ingredients that did not resolve", async () => {
    actionMock.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.9, resolvedCount: 1, totalCount: 2 },
            ingredients: [
              { item: "flour", grams: 125, resolved: true },
              { item: "saffron", grams: null, resolved: false, reason: "no food match" },
            ],
          }),
        },
      ],
      week: estimate(),
    });

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/Not counted/)).toBeTruthy();
    expect(screen.getByText("saffron")).toBeTruthy();
  });

  it("suppresses a day's figures below the coverage threshold", async () => {
    actionMock.mockResolvedValue({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 4 },
          }),
        },
      ],
      week: estimate(),
    });

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/Not enough identified to estimate \(about 30%\)/)).toBeTruthy();
  });

  it("says the week itself could not be estimated", async () => {
    actionMock.mockResolvedValue({
      days: [{ weekday: 0, estimate: estimate() }],
      week: estimate({ coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 5 } }),
    });

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/Not enough of this week could be identified/)).toBeTruthy();
  });

  it("invites the user to plan a day when nothing is scheduled", async () => {
    actionMock.mockResolvedValue({ days: [], week: null });

    render(<PlanNutrition items={[]} />);

    expect(await screen.findByText(/Put a recipe on a day/)).toBeTruthy();
  });

  it("surfaces a failure with a retry rather than an empty panel", async () => {
    actionMock.mockRejectedValue(new Error("recipe-service is down"));

    render(<PlanNutrition items={items} />);

    expect(await screen.findByText(/recipe-service is down/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  // Re-asking on every render would hammer the service; never re-asking would
  // leave stale figures next to an edited plan.
  it("re-asks when the plan changes but not when it is merely re-rendered", async () => {
    actionMock.mockResolvedValue({
      days: [{ weekday: 0, estimate: estimate() }],
      week: estimate(),
    });

    const { rerender } = render(<PlanNutrition items={items} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    rerender(<PlanNutrition items={[{ ...items[0] }]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    rerender(<PlanNutrition items={[{ ...items[0], servingsMultiplier: 2 }]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
  });

  // BL-0038 rides on this card because it consumes the very same rollup. One
  // fetch, so the totals and the verdict about them can never disagree.
  it("judges the user's goals against the rollup it already fetched", async () => {
    goals.rows = [
      {
        _id: "t1",
        _creationTime: 0,
        userId: "u",
        nutrientId: "1008",
        operator: "<=",
        value: 100,
        period: "day",
        active: true,
      },
    ];
    actionMock.mockResolvedValue({
      days: [{ weekday: 0, estimate: estimate() }],
      week: estimate(),
    });

    render(<PlanNutrition items={items} />);
    const chip = await screen.findByText(/Calories ≤ 100 kcal/);
    expect(chip.closest("li")?.dataset.status).toBe("over");
    expect(actionMock).toHaveBeenCalledTimes(1);
  });

  // BL-0049. A day is the period the Daily Value is defined against, so the day
  // rollup is the one plan surface the panel belongs on; the week keeps its
  // compact grid, because a percentage of seven daily values is not a figure
  // anyone reads on a label.
  describe("the day's Nutrition Facts panel", () => {
    it("opens a day's panel on demand and reports the day's own total", async () => {
      actionMock.mockResolvedValue({
        days: [
          {
            weekday: 0,
            estimate: estimate({
              nutrients: {
                "1008": { nutrientId: "1008", amount: 1800, unit: "kcal" },
                "1093": { nutrientId: "1093", amount: 2300, unit: "mg" },
              },
            }),
          },
        ],
        week: estimate(),
      });

      render(<PlanNutrition items={items} />);
      const toggle = await screen.findByRole("button", { name: "Nutrition Facts" });
      expect(screen.queryByRole("table")).toBeNull();

      fireEvent.click(toggle);

      expect(screen.getByText("Monday · whole day")).toBeTruthy();
      // No divisor: a whole day's sodium is a whole day's Daily Value.
      const sodium = screen.getByRole("rowheader", { name: "Sodium" }).closest("tr");
      expect(sodium?.textContent).toContain("2300 mg");
      expect(sodium?.textContent).toContain("100%");
    });

    it("offers no panel for a day it will not put a number on", async () => {
      actionMock.mockResolvedValue({
        days: [
          {
            weekday: 0,
            estimate: estimate({
              coverage: { resolvedMassFraction: 0.4, resolvedCount: 1, totalCount: 3 },
            }),
          },
        ],
        week: estimate(),
      });

      render(<PlanNutrition items={items} />);
      expect(await screen.findByText(/Not enough identified to estimate/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Nutrition Facts" })).toBeNull();
    });

    it("leaves the week on its compact grid", async () => {
      actionMock.mockResolvedValue({
        days: [{ weekday: 0, estimate: estimate() }],
        week: estimate(),
      });

      render(<PlanNutrition items={items} />);
      await screen.findByText(/across 1 planned day/);
      // Exactly one toggle — the day's. The week has none.
      expect(screen.getAllByRole("button", { name: "Nutrition Facts" })).toHaveLength(1);
    });
  });
});
