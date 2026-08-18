// @vitest-environment jsdom
import type { EquipmentMatch } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  unlockedBy: vi.fn(async () => [] as unknown),
  basketAdd: vi.fn(async () => undefined as unknown),
}));

vi.mock("convex/react", () => {
  const mutation = () => {
    const fn = ((...args: unknown[]) => state.basketAdd(...(args as []))) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  };
  return { useAction: () => state.unlockedBy, useMutation: mutation };
});

const { useKitchenUnlocks } = await import("./useKitchenUnlocks");

function match(over: Partial<EquipmentMatch> = {}): EquipmentMatch {
  return {
    id: "r1",
    userId: "catalog",
    title: "Smoked brisket",
    ingredients: [],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    status: "makeable",
    missing: [],
    unlockedBy: ["smoker"],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.unlockedBy.mockResolvedValue([match()]);
  state.basketAdd.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("what a new device unlocks", () => {
  it("asks about the one device", async () => {
    const { result } = renderHook(() => useKitchenUnlocks("smoker"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.unlockedBy).toHaveBeenCalledWith({ equipmentId: "smoker" });
    expect(result.current.recipes.map((r) => r.id)).toEqual(["r1"]);
  });

  it("treats an empty answer as an ordinary result, not an error", async () => {
    state.unlockedBy.mockResolvedValue([]);

    const { result } = renderHook(() => useKitchenUnlocks("smoker"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("re-asks when the spotlight moves to another device", async () => {
    const { rerender, result } = renderHook(({ id }) => useKitchenUnlocks(id), {
      initialProps: { id: "smoker" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ id: "panini_press" });

    await waitFor(() =>
      expect(state.unlockedBy).toHaveBeenLastCalledWith({ equipmentId: "panini_press" }),
    );
  });

  it("surfaces a failed lookup so the retry affordance has something to say", async () => {
    state.unlockedBy.mockRejectedValueOnce(new Error("service down"));

    const { result } = renderHook(() => useKitchenUnlocks("smoker"));

    await waitFor(() => expect(result.current.error).toBe("service down"));
  });
});

describe("basketing an unlocked recipe", () => {
  it("adds it by id", async () => {
    const { result } = renderHook(() => useKitchenUnlocks("smoker"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addToBasket(result.current.recipes[0]));

    await waitFor(() =>
      expect(state.basketAdd).toHaveBeenCalledWith({ recipeId: "r1", title: "Smoked brisket" }),
    );
  });

  it("reports a failed add separately from a failed lookup", async () => {
    state.basketAdd.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useKitchenUnlocks("smoker"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addToBasket(result.current.recipes[0]));

    await waitFor(() => expect(result.current.addError).toBe("offline"));
    expect(result.current.error).toBeNull();
  });
});
