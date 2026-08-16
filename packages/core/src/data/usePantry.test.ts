// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted and mutable so each test sets the query result. `setUseItUp` gets its
// own spy so its tests assert against it directly rather than guessing which
// call on a shared spy was theirs; useMutation dispatches on the api ref's
// function name, the same technique apps/web's suites use.
const { state, mutationMock, setUseItUpMock } = vi.hoisted(() => ({
  state: { rows: undefined as Array<Record<string, unknown>> | undefined },
  mutationMock: vi.fn(() => Promise.resolve()),
  setUseItUpMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => state.rows,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const spy = getFunctionName(ref).endsWith("setUseItUp") ? setUseItUpMock : mutationMock;
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

import { type PantryItem, usePantry } from "./usePantry";

const rows = [
  {
    _id: "p1",
    _creationTime: 0,
    userId: "dev-user",
    canonicalItem: "butter",
    display: "Butter",
    aisle: "dairy",
    state: "have",
    source: "auto",
    useItUp: false,
    updatedAt: 0,
  },
  {
    _id: "p2",
    _creationTime: 0,
    userId: "dev-user",
    canonicalItem: "milk",
    display: "Milk",
    aisle: "dairy",
    state: "low",
    source: "auto",
    useItUp: true,
    updatedAt: 0,
  },
  {
    _id: "p3",
    _creationTime: 0,
    userId: "dev-user",
    canonicalItem: "green onion",
    display: "Green onion",
    aisle: "produce",
    state: "out",
    source: "manual",
    useItUp: false,
    updatedAt: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = rows;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePantry", () => {
  it("groups rows into consecutive aisle runs, in the server's order", () => {
    const { result } = renderHook(() => usePantry());
    expect(result.current.groups.map((g) => g.aisle)).toEqual(["dairy", "produce"]);
    expect(result.current.groups[0].lines.map((l) => l.display)).toEqual(["Butter", "Milk"]);
    expect(result.current.items).toHaveLength(3);
  });

  it("reports loading until the first response, so it is not read as an empty pantry", () => {
    state.rows = undefined;
    const { result } = renderHook(() => usePantry());
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.groups).toEqual([]);
  });

  it("is not loading once the pantry answers, even with nothing in it", () => {
    state.rows = [];
    const { result } = renderHook(() => usePantry());
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("cycles have -> low", async () => {
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.cycleState(result.current.items[0]));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1", state: "low" });
  });

  it("cycles low -> out", async () => {
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.cycleState(result.current.items[1]));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p2", state: "out" });
  });

  it("wraps out -> have, because restocking is the common case", async () => {
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.cycleState(result.current.items[2]));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p3", state: "have" });
  });

  it("flips the use-it-up flag in both directions", async () => {
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.toggleUseItUp(result.current.items[0]));
    expect(setUseItUpMock).toHaveBeenCalledWith({ id: "p1", useItUp: true });
    await act(async () => result.current.toggleUseItUp(result.current.items[1]));
    expect(setUseItUpMock).toHaveBeenCalledWith({ id: "p2", useItUp: false });
  });

  it("removes a row by id", async () => {
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.remove(result.current.items[0]));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1" });
  });

  it("surfaces a failed mutation as an error string rather than throwing", async () => {
    mutationMock.mockRejectedValueOnce(new Error("pantry is down") as never);
    const { result } = renderHook(() => usePantry());
    await act(async () => result.current.remove(result.current.items[0]));
    expect(result.current.error).toBe("pantry is down");
  });

  it("keeps the row type usable as the mutation argument", () => {
    // A compile-level guard: if PantryItem ever stopped carrying the branded
    // `_id`, this assignment would still pass vitest but fail `tsc`.
    const { result } = renderHook(() => usePantry());
    const item: PantryItem = result.current.items[0];
    expect(item.display).toBe("Butter");
  });
});
