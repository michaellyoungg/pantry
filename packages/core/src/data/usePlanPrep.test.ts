// @vitest-environment jsdom
import type { PrepMeal, PrepTask, PrepTasksResponse } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  plan: [] as unknown[],
  states: [] as Array<{ taskKey: string; cookDate: string; done: boolean }>,
  derive: vi.fn(async () => ({ rulesVersion: "test.1", meals: [] }) as unknown),
  setDone: vi.fn(async () => undefined),
}));

// Two queries, so the mock has to tell them apart. anyApi references are fresh
// proxies on every access, so identity comparison would silently always pick
// the same branch; the function NAME is stable.
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).startsWith("basket") ? state.plan : state.states,
    useAction: () => state.derive,
    // The tick is optimistic, so the mock has to be callable AND carry
    // .withOptimisticUpdate or the hook throws on render.
    useMutation: () => Object.assign(state.setDone, { withOptimisticUpdate: () => state.setDone }),
  };
});

const { usePlanPrep } = await import("./usePlanPrep");
const { stateKey } = await import("../prep");

// Wed 5 Aug 2026, local. The week it belongs to starts Mon 3 Aug.
const NOW = new Date(2026, 7, 5, 9, 0);

function task(over: Partial<PrepTask> = {}): PrepTask {
  return {
    key: "thaw_frozen_protein:turkey",
    ruleId: "thaw_frozen_protein",
    subject: "turkey",
    window: "night_before",
    text: "Move the turkey to the fridge to thaw",
    source: "rule",
    dueOn: "2026-08-05",
    ...over,
  };
}

function meal(over: Partial<PrepMeal> = {}): PrepMeal {
  return {
    recipeId: "r1",
    title: "Roast turkey",
    cookDate: "2026-08-06",
    tasks: [task()],
    ...over,
  };
}

function reply(meals: PrepMeal[]): () => Promise<PrepTasksResponse> {
  return async () => ({ rulesVersion: "test.1", meals });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.plan = [];
  state.states = [];
  state.derive.mockImplementation(reply([]));
});

// The hook owns an async load, so a suite that never unmounts leaks a settling
// promise into the next test's act() scope.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePlanPrep", () => {
  // The planner stores only a weekday, so the week has to be resolved against a
  // Monday before anything can be "due" — and against the USER's local date,
  // which the server does not know.
  it("derives against this week and this local date", async () => {
    renderHook(() => usePlanPrep({ now: NOW }));

    await waitFor(() => expect(state.derive).toHaveBeenCalled());
    expect(state.derive).toHaveBeenCalledWith({ weekStart: "2026-08-03", today: "2026-08-05" });
  });

  it("returns the derived meals once they arrive", async () => {
    state.derive.mockImplementation(reply([meal()]));
    const { result } = renderHook(() => usePlanPrep({ now: NOW }));

    await waitFor(() => expect(result.current.meals).toHaveLength(1));
    expect(result.current.meals[0].title).toBe("Roast turkey");
    expect(result.current.loading).toBe(false);
  });

  it("takes an injected action, so web can trace what native cannot", async () => {
    const traced = vi.fn(reply([meal()]));
    renderHook(() => usePlanPrep({ forPlan: traced, now: NOW }));

    await waitFor(() => expect(traced).toHaveBeenCalled());
    expect(state.derive).not.toHaveBeenCalled();
  });

  it("scopes a tick to its cook date", async () => {
    state.states = [
      { taskKey: "thaw_frozen_protein:turkey", cookDate: "2026-08-06", done: true },
      { taskKey: "other", cookDate: "2026-08-13", done: true },
    ];
    const { result } = renderHook(() => usePlanPrep({ now: NOW }));

    // Built with `stateKey`, never hand-written: the separator is deliberately
    // a character a task key cannot contain, not the space it prints as.
    expect(result.current.done.has(stateKey("thaw_frozen_protein:turkey", "2026-08-06"))).toBe(
      true,
    );
    expect(result.current.done.has(stateKey("thaw_frozen_protein:turkey", "2026-08-13"))).toBe(
      false,
    );
    await waitFor(() => expect(state.derive).toHaveBeenCalled());
  });

  it("records a tick against the meal's cook date, not today", async () => {
    const { result } = renderHook(() => usePlanPrep({ now: NOW }));

    await act(async () => {
      await result.current.setDone("thaw_frozen_protein:turkey", "2026-08-06", true);
    });

    expect(state.setDone).toHaveBeenCalledWith({
      taskKey: "thaw_frozen_protein:turkey",
      cookDate: "2026-08-06",
      done: true,
    });
  });

  // Deriving once on mount would leave every surface lying about a meal the
  // user just scheduled — which is precisely when they needed telling.
  it("re-derives when the plan changes", async () => {
    const { rerender } = renderHook(() => usePlanPrep({ now: NOW }));
    await waitFor(() => expect(state.derive).toHaveBeenCalledTimes(1));

    state.plan = [{ recipeId: "r1", weekday: 3 }];
    rerender();

    await waitFor(() => expect(state.derive).toHaveBeenCalledTimes(2));
  });

  it("does not re-derive for an edit prep cannot depend on", async () => {
    state.plan = [{ recipeId: "r1", weekday: 3, servingsMultiplier: 1 }];
    const { rerender } = renderHook(() => usePlanPrep({ now: NOW }));
    await waitFor(() => expect(state.derive).toHaveBeenCalledTimes(1));

    // A double batch thaws the same chicken.
    state.plan = [{ recipeId: "r1", weekday: 3, servingsMultiplier: 2 }];
    rerender();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.derive).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed derivation rather than reporting an empty week", async () => {
    state.derive.mockRejectedValue(new Error("recipe-service unreachable"));
    const { result } = renderHook(() => usePlanPrep({ now: NOW }));

    await waitFor(() => expect(result.current.error).toBe("recipe-service unreachable"));
    expect(result.current.meals).toEqual([]);
  });
});
