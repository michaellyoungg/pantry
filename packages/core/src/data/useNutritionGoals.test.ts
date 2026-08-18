// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: undefined as unknown[] | undefined,
  mutate: vi.fn(async () => undefined as unknown),
  /** Every mutation argument this hook sent, in order. */
  calls: [] as Record<string, unknown>[],
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.rows,
  // A mutation reference carries no usable name at runtime, so each call is
  // identified below by the argument shape the hook chose to send.
  useMutation: () => (args: Record<string, unknown>) => {
    state.calls.push(args);
    return state.mutate();
  },
}));

const { useNutritionGoals } = await import("./useNutritionGoals");

const row = (over: Record<string, unknown> = {}) => ({
  _id: "t1",
  _creationTime: 0,
  userId: "u1",
  nutrientId: "1003",
  operator: ">=" as const,
  value: 150,
  period: "day" as const,
  active: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.rows = [];
  state.mutate.mockResolvedValue(undefined);
});

afterEach(cleanup);

/** The one call this assertion cares about, by the argument shape it carries. */
function callWith(match: (args: Record<string, unknown>) => boolean) {
  return state.calls.find(match);
}

describe("the stored goals", () => {
  it("buckets goals by window, in editor order, omitting the empty ones", () => {
    state.rows = [
      row({ _id: "t1", period: "meal" }),
      row({ _id: "t2", period: "day" }),
      row({ _id: "t3", period: "day", nutrientId: "1093" }),
    ];

    const { result } = renderHook(() => useNutritionGoals());

    expect(result.current.groups.map((g) => g.heading)).toEqual(["Per day", "Per meal"]);
    expect(result.current.groups[0].rows.map((r) => r._id)).toEqual(["t2", "t3"]);
  });

  // "No goals yet" is a claim about the account, and it must not flash before
  // the first response makes it true.
  it("tells 'still loading' apart from 'you have no goals'", () => {
    state.rows = undefined;

    const { result } = renderHook(() => useNutritionGoals());

    expect(result.current.loading).toBe(true);
    expect(result.current.groups).toEqual([]);
  });
});

describe("the add form", () => {
  it("starts on the first headline nutrient, per day, at least", () => {
    const { result } = renderHook(() => useNutritionGoals());

    expect(result.current.draft).toEqual({
      nutrientId: "1008",
      operator: ">=",
      value: "",
      period: "day",
    });
    expect(result.current.draftUnit).toBe("kcal");
  });

  it("follows the drafted nutrient's unit, for the amount field's label", () => {
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.patchDraft({ nutrientId: "1093" }));

    expect(result.current.draftUnit).toBe("mg");
  });

  it("refuses to store a goal with no usable amount", () => {
    const { result } = renderHook(() => useNutritionGoals());

    expect(result.current.canAdd).toBe(false);
    act(() => result.current.addGoal());
    expect(state.calls).toEqual([]);

    act(() => result.current.patchDraft({ value: "-3" }));
    expect(result.current.canAdd).toBe(false);
  });

  it("stores the drafted goal and clears the amount for the next one", async () => {
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.patchDraft({ nutrientId: "1093", operator: "<=", value: "2300" }));
    expect(result.current.canAdd).toBe(true);
    act(() => result.current.addGoal());

    await waitFor(() => expect(result.current.draft.value).toBe(""));
    expect(callWith((a) => a.nutrientId === "1093")).toEqual({
      nutrientId: "1093",
      operator: "<=",
      value: 2300,
      period: "day",
    });
    // The rest of the draft survives, so adding a second sodium goal is one edit.
    expect(result.current.draft.nutrientId).toBe("1093");
  });
});

describe("editing a stored goal", () => {
  beforeEach(() => {
    state.rows = [row()];
  });

  it("pauses and resumes rather than deleting", async () => {
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.togglePaused(result.current.targets[0]));

    await waitFor(() => expect(callWith((a) => "active" in a)).toBeDefined());
    expect(callWith((a) => "active" in a)).toEqual({ id: "t1", active: false });
  });

  it("promotes a preference to a required constraint", async () => {
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.toggleHard(result.current.targets[0]));

    await waitFor(() => expect(callWith((a) => "hard" in a)).toBeDefined());
    expect(callWith((a) => "hard" in a)).toEqual({ id: "t1", hard: true });
  });

  it("demotes a required constraint back to a preference", async () => {
    state.rows = [row({ hard: true })];
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.toggleHard(result.current.targets[0]));

    await waitFor(() => expect(callWith((a) => "hard" in a)).toBeDefined());
    expect(callWith((a) => "hard" in a)).toEqual({ id: "t1", hard: false });
  });

  it("removes a goal by its branded id", async () => {
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.removeGoal(result.current.targets[0]));

    await waitFor(() => expect(callWith((a) => Object.keys(a).length === 1)).toBeDefined());
    expect(callWith((a) => Object.keys(a).length === 1)).toEqual({ id: "t1" });
  });

  it("surfaces a failed write", async () => {
    state.mutate.mockRejectedValue(new Error("Target not found"));
    const { result } = renderHook(() => useNutritionGoals());

    act(() => result.current.removeGoal(result.current.targets[0]));

    await waitFor(() => expect(result.current.error).toBe("Target not found"));
  });
});

describe("diet presets", () => {
  // Nothing downstream knows a diet exists: applying one writes ordinary rows,
  // which is why a new preset is an entry in a JSON file and no code at all.
  it("applies a preset as the rows it is made of", async () => {
    const { result } = renderHook(() => useNutritionGoals());
    const preset = result.current.presets[0];

    act(() => result.current.applyPreset(preset));

    await waitFor(() => expect(callWith((a) => "targets" in a)).toBeDefined());
    expect(callWith((a) => "targets" in a)).toEqual({ targets: preset.targets });
  });

  it("offers the shared preset table rather than a copy", () => {
    const { result } = renderHook(() => useNutritionGoals());

    expect(result.current.presets.length).toBeGreaterThan(0);
    expect(result.current.presets.every((p) => p.targets.length > 0)).toBe(true);
  });
});
