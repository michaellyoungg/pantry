import { describe, expect, it, vi } from "vitest";
import {
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  removeFromBasketOptimistic,
  toggleItemOptimistic,
} from "./optimistic";

// Minimal fake store: a single cached value, ignoring which query is asked for.
function fakeStore(initial: unknown) {
  const state = { value: initial };
  const store = {
    getQuery: vi.fn(() => state.value),
    setQuery: vi.fn((_query: unknown, _args: unknown, next: unknown) => {
      state.value = next;
    }),
  };
  return { store, state };
}

describe("toggleItemOptimistic", () => {
  it("flips checked only on the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: false },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: false },
    ]);
    toggleItemOptimistic(store as never, { id: "g1" as never, checked: true });
    expect(state.value).toEqual([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: true },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: false },
    ]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    toggleItemOptimistic(store as never, { id: "g1" as never, checked: true });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("removeFromBasketOptimistic", () => {
  it("filters out the matching recipeId", () => {
    const { store, state } = fakeStore([
      { _id: "b1", recipeId: "r1", title: "Toast" },
      { _id: "b2", recipeId: "r2", title: "Salad" },
    ]);
    removeFromBasketOptimistic(store as never, { recipeId: "r1" });
    expect(state.value).toEqual([{ _id: "b2", recipeId: "r2", title: "Salad" }]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    removeFromBasketOptimistic(store as never, { recipeId: "r1" });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("clearGroceryListOptimistic", () => {
  it("empties the grocery list cache", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: false },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: true },
    ]);
    clearGroceryListOptimistic(store as never);
    expect(state.value).toEqual([]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    clearGroceryListOptimistic(store as never);
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("needItAnywayOptimistic", () => {
  it("clears alreadyHave only on the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "butter", alreadyHave: true },
      { _id: "g2", item: "milk", alreadyHave: true },
    ]);
    needItAnywayOptimistic(store as never, { id: "g1" as never });
    expect(state.value).toEqual([
      { _id: "g1", item: "butter", alreadyHave: false },
      { _id: "g2", item: "milk", alreadyHave: true },
    ]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    needItAnywayOptimistic(store as never, { id: "g1" as never });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
