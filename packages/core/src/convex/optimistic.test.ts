import { describe, expect, it, vi } from "vitest";
import {
  addToBasketOptimistic,
  clearGroceryListOptimistic,
  finishShoppingOptimistic,
  needItAnywayOptimistic,
  removeFromBasketOptimistic,
  removeItemOptimistic,
  removePantryItemOptimistic,
  setPantryStateOptimistic,
  setPrepTaskDoneOptimistic,
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

describe("addToBasketOptimistic", () => {
  it("appends a row when the recipe is not already in the basket", () => {
    const { store, state } = fakeStore([{ _id: "b1", recipeId: "r1", title: "Toast" }]);
    addToBasketOptimistic(store as never, { recipeId: "r2", title: "Salad" });
    expect((state.value as Array<{ recipeId: string }>).map((b) => b.recipeId)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("carries the household default so the placeholder row scales like the real one", () => {
    const { store, state } = fakeStore([]);
    addToBasketOptimistic(store as never, {
      recipeId: "r2",
      title: "Salad",
      servingsMultiplier: 2,
    });
    expect((state.value as Array<{ servingsMultiplier?: number }>)[0].servingsMultiplier).toBe(2);
  });

  it("is a no-op when the recipe is already in the basket", () => {
    const { store, state } = fakeStore([{ _id: "b1", recipeId: "r1", title: "Toast" }]);
    addToBasketOptimistic(store as never, { recipeId: "r1", title: "Toast" });
    expect((state.value as unknown[]).length).toBe(1);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    addToBasketOptimistic(store as never, { recipeId: "r1", title: "x" });
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

describe("setPantryStateOptimistic", () => {
  it("sets state only on the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "p1", item: "rice", state: "have" },
      { _id: "p2", item: "beans", state: "have" },
    ]);
    setPantryStateOptimistic(store as never, { id: "p1" as never, state: "out" });
    expect(state.value).toEqual([
      { _id: "p1", item: "rice", state: "out" },
      { _id: "p2", item: "beans", state: "have" },
    ]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    setPantryStateOptimistic(store as never, { id: "p1" as never, state: "low" });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("removePantryItemOptimistic", () => {
  it("filters out the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "p1", item: "rice" },
      { _id: "p2", item: "beans" },
    ]);
    removePantryItemOptimistic(store as never, { id: "p1" as never });
    expect(state.value).toEqual([{ _id: "p2", item: "beans" }]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    removePantryItemOptimistic(store as never, { id: "p1" as never });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("setPrepTaskDoneOptimistic", () => {
  const row = (taskKey: string, cookDate: string) => ({ taskKey, cookDate, done: true });

  it("adds a row when the task is ticked", () => {
    const { store, state } = fakeStore([]);
    setPrepTaskDoneOptimistic(store as never, {
      taskKey: "thaw:turkey",
      cookDate: "2026-08-05",
      done: true,
    });
    expect(state.value).toEqual([row("thaw:turkey", "2026-08-05")]);
  });

  it("removes the row when unticked, because absence IS not-done", () => {
    const { store, state } = fakeStore([row("thaw:turkey", "2026-08-05")]);
    setPrepTaskDoneOptimistic(store as never, {
      taskKey: "thaw:turkey",
      cookDate: "2026-08-05",
      done: false,
    });
    expect(state.value).toEqual([]);
  });

  // A double-tap must not stack two rows into the cache and make the list
  // flicker when the server confirms.
  it("is idempotent when ticked twice", () => {
    const { store, state } = fakeStore([row("thaw:turkey", "2026-08-05")]);
    setPrepTaskDoneOptimistic(store as never, {
      taskKey: "thaw:turkey",
      cookDate: "2026-08-05",
      done: true,
    });
    expect(state.value).toEqual([row("thaw:turkey", "2026-08-05")]);
  });

  // The same task for two dinners is two independent ticks.
  it("leaves the same task on another cook date alone", () => {
    const { store, state } = fakeStore([row("thaw:turkey", "2026-08-12")]);
    setPrepTaskDoneOptimistic(store as never, {
      taskKey: "thaw:turkey",
      cookDate: "2026-08-05",
      done: false,
    });
    expect(state.value).toEqual([row("thaw:turkey", "2026-08-12")]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    setPrepTaskDoneOptimistic(store as never, {
      taskKey: "thaw:turkey",
      cookDate: "2026-08-05",
      done: true,
    });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("removeItemOptimistic", () => {
  it("drops the row the moment the finger lifts", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "foil", checked: false },
      { _id: "g2", item: "milk", checked: false },
    ]);
    removeItemOptimistic(store as never, { id: "g1" as never });
    expect(state.value).toEqual([{ _id: "g2", item: "milk", checked: false }]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    removeItemOptimistic(store as never, { id: "g1" as never });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("finishShoppingOptimistic", () => {
  const list = [
    { _id: "g1", item: "milk", checked: true },
    { _id: "g2", item: "eggs", checked: false },
  ];

  it("takes the bought half and leaves the rest", () => {
    const { store, state } = fakeStore(list);
    finishShoppingOptimistic(store as never, { unbought: "keep" });
    expect(state.value).toEqual([{ _id: "g2", item: "eggs", checked: false }]);
  });

  it("empties the list when the unbought half goes too", () => {
    const { store, state } = fakeStore(list);
    finishShoppingOptimistic(store as never, { unbought: "remove" });
    expect(state.value).toEqual([]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    finishShoppingOptimistic(store as never, { unbought: "keep" });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
