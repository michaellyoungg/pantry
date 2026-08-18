// @vitest-environment jsdom
import type { NutritionEstimate, NutritionTarget } from "@pantry/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedItem } from "../planner";

const state = vi.hoisted(() => ({
  planNutrition: vi.fn(async () => ({}) as unknown),
  targets: [] as unknown[] | undefined,
}));

vi.mock("convex/react", () => ({
  useAction: () => state.planNutrition,
  useQuery: () => state.targets,
}));

const { usePlanNutrition } = await import("./usePlanNutrition");

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 2100, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 95, unit: "g" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 3, totalCount: 3 },
    ingredients: [{ item: "rice", grams: 185, resolved: true }],
    estimatedAt: "2026-08-17T12:00:00Z",
    recipes: [
      {
        recipeId: "r1",
        title: "Chili",
        multiplier: 1,
        counted: true,
        coverage: { resolvedMassFraction: 1, resolvedCount: 3, totalCount: 3 },
      },
    ],
    ...over,
  };
}

const ROLLUP = {
  days: [
    { weekday: 0, estimate: estimate() },
    { weekday: 4, estimate: estimate() },
  ],
  week: estimate(),
};

const item = (over: Partial<PlannedItem> = {}): PlannedItem =>
  ({ recipeId: "r1", weekday: 0, ...over }) as PlannedItem;

const dayGoal: NutritionTarget = {
  nutrientId: "1003",
  operator: ">=",
  value: 90,
  period: "day",
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.targets = [];
  state.planNutrition.mockResolvedValue(ROLLUP);
});

afterEach(cleanup);

async function mounted(items: PlannedItem[] = [item()]) {
  const view = renderHook((props: PlannedItem[]) => usePlanNutrition(props), {
    initialProps: items,
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("usePlanNutrition", () => {
  it("rolls the week up into the days that have food on them", async () => {
    const { result } = await mounted();

    expect(result.current.view?.days.map((d) => d.fullLabel)).toEqual(["Monday", "Friday"]);
    expect(result.current.view?.rollup.plannedDays).toBe(2);
  });

  it("has no view until the first rollup settles", () => {
    const { result } = renderHook(() => usePlanNutrition([item()]));

    expect(result.current.loading).toBe(true);
    expect(result.current.view).toBeNull();
  });

  it("surfaces a failed rollup rather than an empty week", async () => {
    state.planNutrition.mockRejectedValue(new Error("estimate failed"));

    const { result } = await mounted();

    expect(result.current.error).toBe("estimate failed");
    expect(result.current.view).toBeNull();
  });

  // Both halves of the surface read one response, which is what stops the
  // totals and the goal chips disagreeing about whether a day is knowable.
  it("scores the goals off the same response as the totals", async () => {
    state.targets = [dayGoal];

    const { result } = await mounted();

    expect(state.planNutrition).toHaveBeenCalledTimes(1);
    expect(result.current.view?.goals?.days).toHaveLength(2);
    expect(result.current.view?.days[0].factsRows.find((r) => r.id === "1003")?.hasTarget).toBe(
      true,
    );
  });

  it("re-asks when the week is actually edited", async () => {
    const { rerender } = await mounted([item()]);

    rerender([item({ weekday: 2 })]);

    await waitFor(() => expect(state.planNutrition).toHaveBeenCalledTimes(2));
  });

  // A leftover is eaten, so flipping meal ↔ leftover moves the grocery list and
  // leaves nutrition alone.
  it("does not re-ask when only the meal type changes", async () => {
    const { rerender } = await mounted([item({ type: "meal" })]);

    rerender([item({ type: "leftover" })]);

    expect(state.planNutrition).toHaveBeenCalledTimes(1);
  });
});
