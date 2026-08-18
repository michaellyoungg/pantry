// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, saveMock } = vi.hoisted(() => ({
  state: { prefs: undefined as { householdSize?: number } | undefined },
  saveMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.prefs,
  useMutation: () => saveMock,
}));

import { useHouseholdSizeEditor } from "./useHouseholdSizeEditor";

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockImplementation(() => Promise.resolve());
  state.prefs = { householdSize: undefined };
});
afterEach(() => vi.restoreAllMocks());

describe("useHouseholdSizeEditor", () => {
  it("shows the stored size", () => {
    state.prefs = { householdSize: 4 };

    expect(renderHook(() => useHouseholdSizeEditor()).result.current.value).toBe("4");
  });

  it("shows nothing when the household size was never set", () => {
    expect(renderHook(() => useHouseholdSizeEditor()).result.current.value).toBe("");
  });

  it("saves the number the user typed", async () => {
    const { result } = renderHook(() => useHouseholdSizeEditor());

    act(() => result.current.setValue("3"));
    act(() => result.current.save());

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ householdSize: 3 }));
  });

  // "I'd rather not say" has to stay reachable: it is what puts every recipe
  // back on a single batch.
  it("clears the preference when the field is emptied", async () => {
    state.prefs = { householdSize: 4 };
    const { result } = renderHook(() => useHouseholdSizeEditor());

    act(() => result.current.setValue(""));
    act(() => result.current.save());

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({}));
  });

  it("refuses anything that is not a whole number of people", async () => {
    const { result } = renderHook(() => useHouseholdSizeEditor());

    for (const bad of ["2.5", "0", "-1", "four"]) {
      act(() => result.current.setValue(bad));
      act(() => result.current.save());
      await waitFor(() => expect(result.current.invalid).toBe(true));
    }
    expect(saveMock).not.toHaveBeenCalled();
  });

  // Complaining while "1" is on its way to "12" is not help.
  it("does not call a half-typed number invalid until it is submitted", () => {
    const { result } = renderHook(() => useHouseholdSizeEditor());

    act(() => result.current.setValue("2.5"));

    expect(result.current.invalid).toBe(false);
  });

  it("follows the stored value again once the save lands", async () => {
    const { result, rerender } = renderHook(() => useHouseholdSizeEditor());

    act(() => result.current.setValue("3"));
    act(() => result.current.save());
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    state.prefs = { householdSize: 3 };
    rerender();
    expect(result.current.value).toBe("3");
  });

  // An empty field before the query lands is indistinguishable from "unset",
  // and one stray keystroke away from overwriting a real answer.
  it("says it is still loading rather than showing an empty field", () => {
    state.prefs = undefined;

    expect(renderHook(() => useHouseholdSizeEditor()).result.current.loading).toBe(true);
  });

  it("surfaces the server's refusal — it holds a ceiling this does not", async () => {
    saveMock.mockImplementation(() =>
      Promise.reject(new Error("householdSize must be at most 20")),
    );
    const { result } = renderHook(() => useHouseholdSizeEditor());

    act(() => result.current.setValue("40"));
    act(() => result.current.save());

    await waitFor(() => expect(result.current.error).toBe("householdSize must be at most 20"));
  });
});
