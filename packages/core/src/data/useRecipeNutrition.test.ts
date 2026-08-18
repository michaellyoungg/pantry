// @vitest-environment jsdom
import type { NutritionEstimate, NutritionTarget } from "@pantry/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  nutrition: vi.fn(async () => ({}) as unknown),
  targets: [] as unknown[] | undefined,
}));

vi.mock("convex/react", () => ({
  useAction: () => state.nutrition,
  useQuery: () => state.targets,
}));

const { useRecipeNutrition } = await import("./useRecipeNutrition");

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 800, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 40, unit: "g" },
    },
    perServing: {
      "1008": { nutrientId: "1008", amount: 200, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 10, unit: "g" },
    },
    servings: 4,
    coverage: { resolvedMassFraction: 1, resolvedCount: 2, totalCount: 2 },
    ingredients: [{ item: "chicken", grams: 400, resolved: true }],
    estimatedAt: "2026-08-17T12:00:00Z",
    ...over,
  };
}

const target: NutritionTarget = {
  nutrientId: "1003",
  operator: ">=",
  value: 5,
  period: "meal",
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.targets = [];
  state.nutrition.mockResolvedValue(estimate());
});

afterEach(cleanup);

async function mounted(recipeId = "r1") {
  const view = renderHook(() => useRecipeNutrition(recipeId));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useRecipeNutrition", () => {
  it("asks recipe-service for the estimate and reads it into a view", async () => {
    const { result } = await mounted();

    expect(state.nutrition).toHaveBeenCalledWith({ id: "r1" });
    expect(result.current.view).toMatchObject({
      kind: "estimate",
      servingsLabel: "4 servings per recipe",
    });
  });

  // "Estimating…" and "no nutrition" are different sentences, and a round trip
  // is long enough for the difference to be visible.
  it("has no view while the first estimate is in flight", () => {
    const { result } = renderHook(() => useRecipeNutrition("r1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.view).toBeNull();
  });

  it("surfaces a failed estimate rather than an empty panel", async () => {
    state.nutrition.mockRejectedValue(new Error("recipe-service unreachable"));

    const { result } = await mounted();

    expect(result.current.error).toBe("recipe-service unreachable");
    expect(result.current.view).toBeNull();
  });

  it("scores the panel and the verdict against the user's per-meal goals", async () => {
    state.targets = [target];

    const { result } = await mounted();

    const view = result.current.view;
    if (view?.kind !== "estimate") throw new Error("expected an estimate");
    expect(view.rows.find((r) => r.id === "1003")?.hasTarget).toBe(true);
    expect(view.goalFit).toMatchObject({ kind: "verdict", verdict: "fits" });
  });

  it("re-asks when the recipe changes, and only then", async () => {
    const { rerender } = await mounted("r1");
    expect(state.nutrition).toHaveBeenCalledTimes(1);

    rerender();
    expect(state.nutrition).toHaveBeenCalledTimes(1);
  });

  it("re-asks on demand, for a retry affordance", async () => {
    const { result } = await mounted();

    result.current.reload();

    await waitFor(() => expect(state.nutrition).toHaveBeenCalledTimes(2));
  });
});
