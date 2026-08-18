// @vitest-environment jsdom

import type { AvoidResolution } from "@pantry/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, addMock, removeMock } = vi.hoisted(() => ({
  state: { prefs: undefined as Record<string, unknown> | undefined },
  addMock: vi.fn(() => Promise.resolve([] as unknown[])),
  removeMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.prefs,
  useAction: () => addMock,
  useMutation: () => removeMock,
}));

import { DIET_SEEDS, useAvoidList } from "./useAvoidList";

function resolution(over: Partial<AvoidResolution> = {}): AvoidResolution {
  return {
    input: "peanuts",
    canonicalItem: "peanut",
    display: "Peanuts",
    kind: "allergen",
    members: ["Peanut butter", "Peanuts"],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  addMock.mockImplementation(() => Promise.resolve([]));
  state.prefs = { avoidItems: [], avoidResolutions: [] };
});
afterEach(() => vi.restoreAllMocks());

describe("useAvoidList", () => {
  it("labels a stored entry with what the dictionary resolved it to", () => {
    state.prefs = { avoidItems: ["peanut"], avoidResolutions: [resolution()] };

    const { result } = renderHook(() => useAvoidList());

    expect(result.current.entries).toEqual([
      {
        canonicalItem: "peanut",
        display: "Peanuts",
        kind: "allergen",
        members: ["Peanut butter", "Peanuts"],
      },
    ]);
  });

  // Entries predating BL-0052 have no resolution. Showing them as unmatched
  // would be a guess dressed up as a warning about an allergen.
  it("renders an entry with no resolution as its stored key, not as unmatched", () => {
    state.prefs = { avoidItems: ["cilantro"], avoidResolutions: [] };

    const { result } = renderHook(() => useAvoidList());

    expect(result.current.entries).toEqual([
      { canonicalItem: "cilantro", display: "cilantro", kind: "item", members: [] },
    ]);
  });

  it("sends what was typed to be canonicalized rather than storing it raw", async () => {
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.add(["scallion"]));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith({ entries: ["scallion"] }));
  });

  it("removes an entry by its canonical key", async () => {
    state.prefs = { avoidItems: ["peanut"], avoidResolutions: [resolution()] };
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.remove("peanut"));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith({ canonicalItem: "peanut" }));
  });

  it("sends a diet's seed list through the same resolver", async () => {
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.applyDiet("vegetarian"));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith({ entries: DIET_SEEDS.vegetarian }));
  });

  it("offers the diets it has seeds for", () => {
    const { result } = renderHook(() => useAvoidList());

    expect(result.current.diets).toEqual(Object.keys(DIET_SEEDS));
  });

  it("holds writes off until the stored list is known", () => {
    state.prefs = undefined;

    const { result } = renderHook(() => useAvoidList());

    expect(result.current.loading).toBe(true);
    expect(result.current.entries).toEqual([]);
  });
});

// The report is the whole reason resolution happens on entry: a chip that
// matched nothing looks exactly like one that matched, and for a declared
// allergy that is not a cosmetic failure.
describe("what the last add is reported to have done", () => {
  it("reports an entry that matched nothing", async () => {
    const unknown = resolution({ input: "quinuoa", canonicalItem: "quinuoa", kind: "unknown" });
    addMock.mockImplementation(() => Promise.resolve([unknown]));
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.add(["quinuoa"]));

    await waitFor(() => expect(result.current.notes).toEqual([unknown]));
  });

  it("reports a rename, so 'scallion' is visibly now 'green onion'", async () => {
    const renamed = resolution({
      input: "scallion",
      canonicalItem: "green onion",
      display: "Green onion",
      kind: "item",
      members: undefined,
    });
    addMock.mockImplementation(() => Promise.resolve([renamed]));
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.add(["scallion"]));

    await waitFor(() => expect(result.current.notes).toEqual([renamed]));
  });

  // Otherwise applying a diet buries the entries that matter under thirty lines
  // that each say "avoiding the thing you asked to avoid".
  it("stays quiet about an entry that resolved to exactly what was typed", async () => {
    addMock.mockImplementation(() =>
      Promise.resolve([
        resolution({ input: "Milk", canonicalItem: "milk", display: "Milk", kind: "item" }),
      ]),
    );
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.add(["Milk"]));

    await waitFor(() => expect(addMock).toHaveBeenCalled());
    expect(result.current.notes).toEqual([]);
  });

  it("keeps a member's family suggestion, which is the nudge to broaden", async () => {
    const member = resolution({
      input: "cheddar cheese",
      canonicalItem: "cheddar cheese",
      display: "Cheddar cheese",
      kind: "item",
      members: undefined,
      families: ["dairy"],
    });
    addMock.mockImplementation(() => Promise.resolve([member]));
    const { result } = renderHook(() => useAvoidList());

    act(() => result.current.add(["cheddar cheese"]));

    await waitFor(() => expect(result.current.notes).toEqual([member]));
  });

  it("clears the report when the add fails, rather than leaving a stale one up", async () => {
    addMock.mockImplementation(() => Promise.resolve([resolution({ kind: "unknown" })]));
    const { result } = renderHook(() => useAvoidList());
    act(() => result.current.add(["peanuts"]));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    addMock.mockImplementation(() => Promise.reject(new Error("dictionary unreachable")));
    act(() => result.current.add(["walnut"]));

    await waitFor(() => expect(result.current.error).toBe("dictionary unreachable"));
    expect(result.current.notes).toEqual([]);
  });

  it("clears the report when an entry is removed", async () => {
    addMock.mockImplementation(() => Promise.resolve([resolution({ kind: "unknown" })]));
    const { result } = renderHook(() => useAvoidList());
    act(() => result.current.add(["peanuts"]));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    act(() => result.current.remove("peanut"));

    await waitFor(() => expect(result.current.notes).toEqual([]));
  });
});
