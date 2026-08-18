// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted and mutable so each test seeds the basket. `useMutation` dispatches on
// the api ref's function name, which is what lets a test say "the servings
// mutation fired" rather than inspecting args on one shared spy — the seven
// planner mutations take overlapping shapes, so args alone are ambiguous.
const { state, mutations, actionMock } = vi.hoisted(() => ({
  state: { rows: undefined as Array<Record<string, unknown>> | undefined },
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  actionMock: vi.fn(() => Promise.resolve({ count: 3 })),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => state.rows,
    useAction: () => actionMock,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref).split(":").pop() as string;
      mutations[name] ??= vi.fn(() => Promise.resolve());
      // Looked up on every CALL, not captured at render: a test that wants one
      // mutation to fail swaps the entry after the hook has already rendered.
      const fn = ((...args: unknown[]) =>
        (mutations[name] as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { type PlannedRow, usePlanWeek } from "./usePlanWeek";

const row = (over: Record<string, unknown>) => ({
  _id: "b1",
  _creationTime: 0,
  userId: "u1",
  recipeId: "r1",
  title: "Toast",
  ...over,
});

/** The first row, typed as the hook hands it back. */
const first = (result: { current: { items: PlannedRow[] } }) => result.current.items[0];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mutations)) delete mutations[key];
  state.rows = [];
});
afterEach(() => vi.restoreAllMocks());

describe("usePlanWeek", () => {
  it("buckets rows into the seven days, Mon…Sun", () => {
    state.rows = [
      row({ weekday: 0 }),
      row({ _id: "b2", recipeId: "r2", title: "Stew", weekday: 3 }),
    ];
    const { result } = renderHook(() => usePlanWeek());

    expect(result.current.days.map((d) => d.fullLabel)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(result.current.days[0].items.map((i) => i.title)).toEqual(["Toast"]);
    expect(result.current.days[3].items.map((i) => i.title)).toEqual(["Stew"]);
    expect(result.current.unscheduled).toEqual([]);
  });

  it("puts a row with no day on the rail rather than on Monday", () => {
    // A missing weekday is not weekday 0 — conflating them would silently plan
    // every fresh basket add onto Monday.
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());

    expect(result.current.days[0].items).toEqual([]);
    expect(result.current.unscheduled.map((i) => i.title)).toEqual(["Toast"]);
  });

  it("reports loading until the first response, so it is not read as an empty basket", () => {
    state.rows = undefined;
    const { result } = renderHook(() => usePlanWeek());

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.canGenerate).toBe(false);
  });

  it("only offers to build a list once something is in the basket", () => {
    const { result, rerender } = renderHook(() => usePlanWeek());
    expect(result.current.canGenerate).toBe(false);

    state.rows = [row({})];
    rerender();
    expect(result.current.canGenerate).toBe(true);
  });

  it("schedules a row onto a day", async () => {
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.schedule(first(result), 2));

    expect(mutations.schedule).toHaveBeenCalledWith({ recipeId: "r1", weekday: 2 });
  });

  it("unschedules a row back onto the rail without removing it", async () => {
    state.rows = [row({ weekday: 1 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.unschedule(first(result)));

    expect(mutations.unschedule).toHaveBeenCalledWith({ recipeId: "r1" });
    expect(mutations.remove).not.toHaveBeenCalled();
  });
});

describe("usePlanWeek servings dial", () => {
  it("steps up from an unset dial, which reads as a single batch", async () => {
    state.rows = [row({ weekday: 0 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.increaseServings(first(result)));

    expect(mutations.setServings).toHaveBeenCalledWith({ recipeId: "r1", servingsMultiplier: 1.5 });
  });

  it("steps down half a batch at a time", async () => {
    state.rows = [row({ weekday: 0, servingsMultiplier: 2 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.decreaseServings(first(result)));

    expect(mutations.setServings).toHaveBeenCalledWith({ recipeId: "r1", servingsMultiplier: 1.5 });
  });

  it("clamps at the quarter-batch floor rather than reaching zero", async () => {
    // Re-asserted here rather than left to planner.test.ts: the clamp is the one
    // arithmetic rule a second client could plausibly re-derive by hand.
    state.rows = [row({ weekday: 0, servingsMultiplier: 0.25 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.decreaseServings(first(result)));

    expect(mutations.setServings).toHaveBeenCalledWith({
      recipeId: "r1",
      servingsMultiplier: 0.25,
    });
  });
});

describe("usePlanWeek leftovers and cooking", () => {
  it("flips a meal to a leftover and back", async () => {
    state.rows = [row({ weekday: 0 })];
    const { result, rerender } = renderHook(() => usePlanWeek());
    await act(async () => result.current.toggleType(first(result)));
    expect(mutations.setType).toHaveBeenCalledWith({ recipeId: "r1", type: "leftover" });

    state.rows = [row({ weekday: 0, type: "leftover" })];
    rerender();
    await act(async () => result.current.toggleType(first(result)));
    expect(mutations.setType).toHaveBeenLastCalledWith({ recipeId: "r1", type: "meal" });
  });

  it("marks an uncooked meal cooked", async () => {
    state.rows = [row({ weekday: 0 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.toggleCooked(first(result)));

    expect(mutations.markCooked).toHaveBeenCalledWith({ recipeId: "r1" });
    expect(mutations.unmarkCooked).not.toHaveBeenCalled();
  });

  it("undoes a cooked mark rather than marking it twice", async () => {
    // markCooked is idempotent server-side, so sending it again would be a
    // silent no-op and the tap would look broken.
    state.rows = [row({ weekday: 0, cookedAt: 1 })];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.toggleCooked(first(result)));

    expect(mutations.unmarkCooked).toHaveBeenCalledWith({ recipeId: "r1" });
    expect(mutations.markCooked).not.toHaveBeenCalled();
  });

  it("removes a recipe from the basket entirely", async () => {
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => result.current.remove(first(result)));

    expect(mutations.remove).toHaveBeenCalledWith({ recipeId: "r1" });
  });
});

describe("usePlanWeek building the list", () => {
  it("resolves true when the generation lands, so the caller can route", async () => {
    state.rows = [row({ weekday: 0 })];
    const { result } = renderHook(() => usePlanWeek());

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.buildList();
    });
    expect(actionMock).toHaveBeenCalledTimes(1);
    expect(landed).toBe(true);
  });

  it("resolves false and surfaces the message when generation fails", async () => {
    actionMock.mockRejectedValueOnce(new Error("recipe service is down") as never);
    state.rows = [row({ weekday: 0 })];
    const { result } = renderHook(() => usePlanWeek());

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.buildList();
    });
    expect(landed).toBe(false);
    expect(result.current.error).toBe("recipe service is down");
  });

  it("takes an injected generator, so a client can trace the call it starts", async () => {
    const traced = vi.fn(() => Promise.resolve({ count: 1 }));
    state.rows = [row({ weekday: 0 })];
    const { result } = renderHook(() => usePlanWeek({ generate: traced }));
    await act(async () => {
      await result.current.buildList();
    });

    expect(traced).toHaveBeenCalledWith({});
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed mutation as an error string rather than throwing", async () => {
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());
    mutations.schedule = vi.fn(() => Promise.reject(new Error("offline")));
    await act(async () => result.current.schedule(first(result), 0));

    expect(result.current.error).toBe("offline");
  });

  it("clears a stale generation failure when the next write starts", async () => {
    // The two slots are read in one place on both clients. Without the
    // cross-clear, a week that failed to build keeps its message next to a
    // scheduling change that just succeeded.
    actionMock.mockRejectedValueOnce(new Error("recipe service is down") as never);
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());
    await act(async () => {
      await result.current.buildList();
    });
    expect(result.current.error).toBe("recipe service is down");

    await act(async () => result.current.schedule(first(result), 4));
    expect(result.current.error).toBeNull();
  });

  it("keeps the row type usable as the mutation argument", () => {
    // A compile-level guard: if PlannedRow stopped carrying the branded `_id`,
    // this assignment would still pass vitest but fail `tsc`.
    state.rows = [row({})];
    const { result } = renderHook(() => usePlanWeek());
    const planned: PlannedRow = result.current.items[0];
    expect(planned.title).toBe("Toast");
  });
});
