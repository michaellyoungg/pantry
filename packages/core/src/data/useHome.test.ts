// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted and mutable so each test stages a different point in the weekly loop.
// `useQuery` dispatches on the api ref's function name, the same technique the
// other hook suites and apps/web use.
const { state, generateMock } = vi.hoisted(() => ({
  state: {
    basket: undefined as Array<Record<string, unknown>> | undefined,
    list: undefined as Array<Record<string, unknown>> | undefined,
  },
  generateMock: vi.fn(() => Promise.resolve({ count: 3 })),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).startsWith("basket") ? state.basket : state.list,
    useAction: () => generateMock,
  };
});

import { useHome } from "./useHome";

function meal(id: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: 0,
    userId: "dev-user",
    recipeId: `r-${id}`,
    title: `Recipe ${id}`,
    ...over,
  };
}

function line(id: string, checked: boolean, over: Record<string, unknown> = {}) {
  return { _id: id, item: `item-${id}`, checked, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.basket = [];
  state.list = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHome", () => {
  it("is loading until both queries answer", () => {
    state.basket = undefined;
    const { result } = renderHook(() => useHome());
    expect(result.current.state).toEqual({ kind: "loading" });
  });

  it("derives the weekly-loop state from the plan and the list", () => {
    state.basket = [meal("a"), meal("b")];
    const { result } = renderHook(() => useHome());
    expect(result.current.state).toEqual({ kind: "planned", mealCount: 2 });
  });

  // Both subscriptions matter: the list is what decides between planning and
  // shopping, and it is checked first so clearing the plan mid-shop cannot yank
  // the handoff away from someone standing in a store.
  it("reads the grocery list too, and lets it outrank the plan", () => {
    state.basket = [];
    state.list = [line("1", true), line("2", false)];
    const { result } = renderHook(() => useHome());
    expect(result.current.state).toEqual({ kind: "shopping", total: 2, checked: 1, remaining: 1 });
  });

  it("ignores lines the plan has dropped, which are history rather than shopping", () => {
    state.basket = [meal("a")];
    state.list = [line("1", true, { removed: true })];
    const { result } = renderHook(() => useHome());
    expect(result.current.state).toEqual({ kind: "planned", mealCount: 1 });
  });

  it("buckets the plan into the seven days of the week strip", () => {
    state.basket = [
      meal("a", { weekday: 0, title: "Chili" }),
      meal("b", { weekday: 0 }),
      meal("c"),
    ];
    const { result } = renderHook(() => useHome());

    expect(result.current.days).toHaveLength(7);
    expect(result.current.days[0].fullLabel).toBe("Monday");
    expect(result.current.days[0].items.map((i) => i.title)).toEqual(["Chili", "Recipe b"]);
    expect(result.current.days[1].items).toEqual([]);
  });

  // The strip shows unscheduled rows nowhere, but they still count toward
  // "N meals ready", so the number that reconciles the two has to come from here.
  it("counts the entries that are not on a day yet", () => {
    state.basket = [meal("a", { weekday: 3 }), meal("b"), meal("c")];
    const { result } = renderHook(() => useHome());
    expect(result.current.unscheduled).toBe(2);
  });

  it("generates the list and reports that it landed, so a view can route", async () => {
    state.basket = [meal("a")];
    const { result } = renderHook(() => useHome());

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.buildList();
    });

    expect(generateMock).toHaveBeenCalledWith({});
    expect(landed).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failed generation and reports that it did not land", async () => {
    state.basket = [meal("a")];
    generateMock.mockRejectedValueOnce(new Error("recipe-service unreachable") as never);
    const { result } = renderHook(() => useHome());

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.buildList();
    });

    expect(landed).toBe(false);
    expect(result.current.error).toBe("recipe-service unreachable");
  });

  // Instrumentation is per-platform (BL-0027 is a web SDK), so the action is
  // injectable — but only the call is, never the decision to make it.
  it("calls the caller's action when one is supplied, not the plain one", async () => {
    const traced = vi.fn(() => Promise.resolve({ count: 1 }));
    state.basket = [meal("a")];
    const { result } = renderHook(() => useHome({ generate: traced }));

    await act(async () => {
      await result.current.buildList();
    });

    expect(traced).toHaveBeenCalledWith({});
    expect(generateMock).not.toHaveBeenCalled();
  });
});
