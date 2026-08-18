// @vitest-environment jsdom
import type { EquipmentDef, PrepMeal, Recipe } from "@pantry/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getRecipe: vi.fn(async () => null as unknown),
  forRecipe: vi.fn(async () => null as unknown),
  listEquipment: vi.fn(async () => [] as unknown),
}));

// Three actions, so the mock has to tell them apart. anyApi references are
// fresh proxies on every access, so identity comparison would silently always
// pick the same branch; the function NAME is stable.
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "recipes:get") return state.getRecipe;
      if (name === "recipes:listEquipment") return state.listEquipment;
      return state.forRecipe;
    },
  };
});

const { useRecipeDetail } = await import("./useRecipeDetail");

const NOW = new Date(2026, 7, 5, 9, 0);

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Roast turkey",
    ingredients: [{ item: "turkey", quantity: 1, unit: "whole" }],
    steps: ["Heat the oven.", "Roast it."],
    equipment: [],
    methods: ["roast"],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function prep(tasks: PrepMeal["tasks"]): PrepMeal {
  return { recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-05", tasks };
}

const OVEN: EquipmentDef = { id: "oven", name: "Oven", category: "appliance", aliases: [] };

beforeEach(() => {
  vi.clearAllMocks();
  state.getRecipe.mockResolvedValue(recipe());
  state.forRecipe.mockResolvedValue(prep([]));
  state.listEquipment.mockResolvedValue([OVEN]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useRecipeDetail", () => {
  it("fetches exactly the recipe the screen was opened for", async () => {
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.recipe?.title).toBe("Roast turkey"));
    expect(state.getRecipe).toHaveBeenCalledWith({ id: "r1" });
    expect(result.current.loading).toBe(false);
    expect(result.current.missing).toBe(false);
  });

  it("is loading rather than empty before the first answer", () => {
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    expect(result.current.loading).toBe(true);
    // "Still loading" and "there is no such recipe" are different answers, and
    // a cooking screen that confuses them tells the user their recipe is gone.
    expect(result.current.missing).toBe(false);
  });

  // The plan can outlive the recipe it points at, so this is an ordinary state
  // for a screen reached from the week strip.
  it("reports a recipe that is gone as missing, not as an error", async () => {
    state.getRecipe.mockResolvedValue(null);
    const { result } = renderHook(() => useRecipeDetail("gone", { now: NOW }));

    await waitFor(() => expect(result.current.missing).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.recipe).toBeUndefined();
  });

  it("keeps a failed load apart from a missing recipe", async () => {
    state.getRecipe.mockRejectedValue(new Error("recipe-service unreachable"));
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.error).toBe("recipe-service unreachable"));
    expect(result.current.missing).toBe(false);
  });

  it("carries the recipe's lead-time prep alongside it", async () => {
    state.forRecipe.mockResolvedValue(
      prep([
        {
          key: "thaw_frozen_protein:turkey",
          ruleId: "thaw_frozen_protein",
          subject: "turkey",
          window: "night_before",
          text: "Move the turkey to the fridge to thaw",
          source: "rule",
          dueOn: "2026-08-04",
        },
      ]),
    );
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.prepTasks).toHaveLength(1));
    expect(result.current.prepTasks[0].text).toMatch(/thaw/);
  });

  // Prep is a second network call against the rule table. A cooking screen must
  // not blank because that call was slow — the recipe is the point.
  it("renders the recipe even when the prep derivation fails", async () => {
    state.forRecipe.mockRejectedValue(new Error("rules unavailable"));
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.recipe?.title).toBe("Roast turkey"));
    expect(result.current.prepTasks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("resolves equipment slugs to their catalog names", async () => {
    state.getRecipe.mockResolvedValue(recipe({ equipment: [{ id: "oven", required: true }] }));
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.equipment).toHaveLength(1));
    expect(result.current.equipment[0]).toEqual({ id: "oven", name: "Oven", required: true });
  });

  // A requirement whose catalog entry is missing still has to render as
  // something on a recipe someone is about to cook from.
  it("falls back to the slug when the catalog cannot name a requirement", async () => {
    state.getRecipe.mockResolvedValue(
      recipe({ equipment: [{ id: "spiralizer", required: false }] }),
    );
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.equipment).toHaveLength(1));
    expect(result.current.equipment[0]).toEqual({
      id: "spiralizer",
      name: "spiralizer",
      required: false,
    });
  });

  it("does not fetch the catalog for a recipe that needs no equipment", async () => {
    const { result } = renderHook(() => useRecipeDetail("r1", { now: NOW }));

    await waitFor(() => expect(result.current.recipe).toBeDefined());
    expect(state.listEquipment).not.toHaveBeenCalled();
  });

  it("takes injected actions, so web can trace what native cannot", async () => {
    const getRecipe = vi.fn(async () => recipe());
    const forRecipe = vi.fn(async () => prep([]));
    const { result } = renderHook(() => useRecipeDetail("r1", { getRecipe, forRecipe, now: NOW }));

    await waitFor(() => expect(result.current.recipe).toBeDefined());
    expect(getRecipe).toHaveBeenCalledWith({ id: "r1" });
    expect(forRecipe).toHaveBeenCalled();
    expect(state.getRecipe).not.toHaveBeenCalled();
  });
});
