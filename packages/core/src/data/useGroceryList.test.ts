// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted and mutable so each test sets both query results. One shared mutation
// spy is enough for most assertions; `restoreItem` gets its own because undo is
// the one path whose argument shape has to be checked in isolation.
const { state, mutationMock, restoreMock } = vi.hoisted(() => ({
  state: {
    lines: undefined as Array<Record<string, unknown>> | undefined,
    leftovers: [] as Array<Record<string, unknown>>,
  },
  mutationMock: vi.fn(() => Promise.resolve()),
  restoreMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", async () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(query).includes("leftoverProposals") ? state.leftovers : state.lines,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const spy = getFunctionName(ref).endsWith("restoreItem") ? restoreMock : mutationMock;
      const fn = ((...args: unknown[]) =>
        (spy as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import {
  CART_TRANSITION_MS,
  type GroceryLine,
  REMOTE_HIGHLIGHT_MS,
  UNDO_MS,
  useGroceryList,
} from "./useGroceryList";

function line(over: Record<string, unknown> = {}) {
  return {
    _id: "g1",
    _creationTime: 0,
    userId: "dev-user",
    item: "egg",
    canonicalItem: "egg",
    unit: "",
    quantity: 1,
    aisle: "dairy",
    checked: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.lines = [line()];
  state.leftovers = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useGroceryList — shape", () => {
  it("reports loading until the first response, so it is not read as an empty list", () => {
    state.lines = undefined;
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.loading).toBe(true);
    expect(result.current.lines).toEqual([]);
  });

  it("is not loading once the list answers, even with nothing on it", () => {
    state.lines = [];
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.loading).toBe(false);
  });

  it("splits the dropped half out of the store walk", () => {
    state.lines = [line({ _id: "a" }), line({ _id: "b", removed: true, checked: true })];
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.active.map((l) => l._id)).toEqual(["a"]);
    expect(result.current.removed.map((l) => l._id)).toEqual(["b"]);
    // The dropped line is already bought; it must not price into this trip.
    expect(result.current.toBuy.map((l) => l._id)).toEqual(["a"]);
  });

  it("groups what is still to buy into the server's aisle order", () => {
    state.lines = [
      line({ _id: "a", aisle: "dairy" }),
      line({ _id: "b", aisle: "dairy" }),
      line({ _id: "c", aisle: "produce" }),
    ];
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.groups.map((g) => g.aisle)).toEqual(["dairy", "produce"]);
    expect(result.current.groups[0].lines.map((l) => l._id)).toEqual(["a", "b"]);
  });

  it("passes unanswered leftover prompts through", () => {
    state.leftovers = [{ _id: "g1", item: "butter" }];
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.pendingLeftovers).toHaveLength(1);
  });
});

describe("useGroceryList — actions", () => {
  it("toggles a line by branded id", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.toggle(result.current.lines[0], true));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1", checked: true });
  });

  it("clears the whole list", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.clear());
    expect(mutationMock).toHaveBeenCalledWith({});
  });

  it("ends the trip with the caller's choice for unbought lines", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.finish("remove"));
    expect(mutationMock).toHaveBeenCalledWith({ unbought: "remove" });
  });

  it("clears the already-have annotation for one line", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.needItAnyway(result.current.lines[0]));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1" });
  });

  it("surfaces a failed mutation as an error string rather than throwing", async () => {
    mutationMock.mockRejectedValueOnce(new Error("list is down") as never);
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.toggle(result.current.lines[0], true));
    expect(result.current.error).toBe("list is down");
  });
});

describe("useGroceryList — undo window", () => {
  it("deletes immediately and offers the snapshot back", async () => {
    state.lines = [line({ manual: true, alreadyHave: true, shelfLifeDays: 7 })];
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.remove(result.current.lines[0]));

    expect(mutationMock).toHaveBeenCalledWith({ id: "g1" });
    // The snapshot carries the restorable columns and none of the system ones —
    // the restore validator rejects anything it does not name.
    expect(result.current.undo).toEqual({
      item: "egg",
      canonicalItem: "egg",
      unit: "",
      quantity: 1,
      aisle: "dairy",
      checked: false,
      alreadyHave: true,
      shelfLifeDays: 7,
      sources: undefined,
      purchase: undefined,
      leftoverDecision: undefined,
      manual: true,
      removed: undefined,
    });
  });

  it("restores the snapshot and closes the offer", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.remove(result.current.lines[0]));
    await act(async () => result.current.undoRemove());

    expect(restoreMock).toHaveBeenCalledWith({ line: expect.objectContaining({ item: "egg" }) });
    expect(result.current.undo).toBeNull();
  });

  it("does nothing when there is no offer standing", async () => {
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.undoRemove());
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("withdraws the offer after the undo window", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.remove(result.current.lines[0]));
    expect(result.current.undo).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(result.current.undo).toBeNull();
  });

  it("a second swipe replaces the offer and restarts its window", async () => {
    vi.useFakeTimers();
    state.lines = [line({ _id: "a", item: "egg" }), line({ _id: "b", item: "milk" })];
    const { result } = renderHook(() => useGroceryList());
    await act(async () => result.current.remove(result.current.lines[0]));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS - 100);
    });
    await act(async () => result.current.remove(result.current.lines[1]));
    expect(result.current.undo?.item).toBe("milk");
    // The first swipe's timer must not close the second swipe's offer.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.undo?.item).toBe("milk");
  });
});

describe("useGroceryList — cart transition", () => {
  it("holds a freshly ticked line in the walk for the length of the animation", async () => {
    vi.useFakeTimers();
    const { rerender, result } = renderHook(() => useGroceryList());
    expect(result.current.leaving.size).toBe(0);

    state.lines = [line({ checked: true })];
    await act(async () => rerender());

    expect(result.current.leaving.has("g1")).toBe(true);
    expect(result.current.toBuy.map((l) => l._id)).toEqual(["g1"]);
    expect(result.current.inCart).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(CART_TRANSITION_MS);
    });
    expect(result.current.leaving.size).toBe(0);
    expect(result.current.inCart.map((l) => l._id)).toEqual(["g1"]);
  });

  it("does not treat the first list it is handed as a batch of fresh ticks", () => {
    state.lines = [line({ checked: true })];
    const { result } = renderHook(() => useGroceryList());
    expect(result.current.leaving.size).toBe(0);
    expect(result.current.inCart.map((l) => l._id)).toEqual(["g1"]);
  });

  it("does not strand a line ticked moments after another", async () => {
    vi.useFakeTimers();
    state.lines = [line({ _id: "a" }), line({ _id: "b" })];
    const { rerender, result } = renderHook(() => useGroceryList());

    state.lines = [line({ _id: "a", checked: true }), line({ _id: "b" })];
    await act(async () => rerender());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    state.lines = [line({ _id: "a", checked: true }), line({ _id: "b", checked: true })];
    await act(async () => rerender());

    // Both timers must survive; the second tick must not cancel the first.
    await act(async () => {
      vi.advanceTimersByTime(CART_TRANSITION_MS + 100);
    });
    expect(result.current.leaving.size).toBe(0);
  });
});

describe("useGroceryList — remote highlight", () => {
  it("flags a change this device did not make", async () => {
    vi.useFakeTimers();
    const { rerender, result } = renderHook(() => useGroceryList());

    state.lines = [line({ checked: true })];
    await act(async () => rerender());
    expect(result.current.highlighted.has("g1")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(REMOTE_HIGHLIGHT_MS);
    });
    expect(result.current.highlighted.size).toBe(0);
  });

  it("does not flag the user's own tap back at them", async () => {
    vi.useFakeTimers();
    const { rerender, result } = renderHook(() => useGroceryList());
    await act(async () => result.current.toggle(result.current.lines[0], true));

    state.lines = [line({ checked: true })];
    await act(async () => rerender());
    expect(result.current.highlighted.size).toBe(0);
  });

  it("re-arms after an own edit is consumed, so the next remote change flashes", async () => {
    vi.useFakeTimers();
    const { rerender, result } = renderHook(() => useGroceryList());
    await act(async () => result.current.toggle(result.current.lines[0], true));

    state.lines = [line({ checked: true })];
    await act(async () => rerender());
    expect(result.current.highlighted.size).toBe(0);

    // Somebody else un-checks it.
    state.lines = [line({ checked: false })];
    await act(async () => rerender());
    expect(result.current.highlighted.has("g1")).toBe(true);
  });

  it("stays quiet while the list is still loading", async () => {
    state.lines = undefined;
    const { rerender, result } = renderHook(() => useGroceryList());
    await act(async () => rerender());
    expect(result.current.highlighted.size).toBe(0);
    expect(result.current.leaving.size).toBe(0);
  });
});

describe("useGroceryList — types", () => {
  it("keeps the row type usable as the mutation argument", () => {
    // A compile-level guard: if GroceryLine ever stopped carrying the branded
    // `_id`, this would still pass vitest but fail `tsc`.
    const { result } = renderHook(() => useGroceryList());
    const row: GroceryLine = result.current.lines[0];
    expect(row.item).toBe("egg");
  });
});
