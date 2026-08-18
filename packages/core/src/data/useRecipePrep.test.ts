// @vitest-environment jsdom
import type { PrepMeal, PrepTask } from "@pantry/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  derive: vi.fn(async () => null as unknown),
}));

vi.mock("convex/react", () => ({ useAction: () => state.derive }));

const { useRecipePrep } = await import("./useRecipePrep");

const NOW = new Date(2026, 7, 5, 9, 0); // Wed 5 Aug 2026, local

function task(over: Partial<PrepTask> = {}): PrepTask {
  return {
    key: "thaw_frozen_protein:turkey",
    ruleId: "thaw_frozen_protein",
    subject: "turkey",
    window: "night_before",
    text: "Move the turkey to the fridge to thaw",
    source: "rule",
    dueOn: "2026-08-04",
    ...over,
  };
}

function meal(tasks: PrepTask[]): () => Promise<PrepMeal> {
  return async () => ({ recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-05", tasks });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.derive.mockImplementation(meal([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useRecipePrep", () => {
  // A recipe being read has no cook date, so the derivation is anchored on the
  // user's local today and the surface renders windows instead of the dates.
  it("derives against today, for the recipe asked for", async () => {
    renderHook(() => useRecipePrep("r1", { now: NOW }));

    await waitFor(() => expect(state.derive).toHaveBeenCalled());
    expect(state.derive).toHaveBeenCalledWith({ recipeId: "r1", cookDate: "2026-08-05" });
  });

  it("returns the tasks the service derived", async () => {
    state.derive.mockImplementation(meal([task()]));
    const { result } = renderHook(() => useRecipePrep("r1", { now: NOW }));

    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    expect(result.current.tasks[0].window).toBe("night_before");
    expect(result.current.loading).toBe(false);
  });

  // A recipe the derivation could not read at all is, for this surface, the
  // same answer as one that needs no prep: there is nothing to show.
  it("treats an unreadable recipe as nothing to do, not as a crash", async () => {
    state.derive.mockResolvedValue(null);
    const { result } = renderHook(() => useRecipePrep("r1", { now: NOW }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toEqual([]);
  });

  it("surfaces a failed derivation without inventing tasks", async () => {
    state.derive.mockRejectedValue(new Error("rules unavailable"));
    const { result } = renderHook(() => useRecipePrep("r1", { now: NOW }));

    await waitFor(() => expect(result.current.error).toBe("rules unavailable"));
    expect(result.current.tasks).toEqual([]);
  });

  it("takes an injected action, so web can trace what native cannot", async () => {
    const traced = vi.fn(meal([task()]));
    renderHook(() => useRecipePrep("r1", { forRecipe: traced, now: NOW }));

    await waitFor(() => expect(traced).toHaveBeenCalled());
    expect(state.derive).not.toHaveBeenCalled();
  });

  it("re-derives when the screen moves to another recipe", async () => {
    const { rerender } = renderHook(({ id }) => useRecipePrep(id, { now: NOW }), {
      initialProps: { id: "r1" },
    });
    await waitFor(() => expect(state.derive).toHaveBeenCalledTimes(1));

    rerender({ id: "r2" });

    await waitFor(() => expect(state.derive).toHaveBeenCalledTimes(2));
    expect(state.derive).toHaveBeenLastCalledWith({ recipeId: "r2", cookDate: "2026-08-05" });
  });
});
