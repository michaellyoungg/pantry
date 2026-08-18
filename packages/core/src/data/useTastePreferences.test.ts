// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, saveMock } = vi.hoisted(() => ({
  state: {
    prefs: undefined as { cuisines?: string[]; maxMinutes?: number } | undefined,
  },
  saveMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.prefs,
  useMutation: () => saveMock,
}));

import { useTastePreferences } from "./useTastePreferences";

beforeEach(() => {
  vi.clearAllMocks();
  state.prefs = { cuisines: [], maxMinutes: undefined };
});
afterEach(() => vi.restoreAllMocks());

describe("useTastePreferences", () => {
  it("labels stored cuisines rather than handing a view the slug", () => {
    state.prefs = { cuisines: ["south-indian"] };

    const { result } = renderHook(() => useTastePreferences());

    expect(result.current.cuisines).toEqual([{ slug: "south-indian", label: "South Indian" }]);
  });

  // The whole reason slugifying happens client-side: stored raw, "South Indian"
  // would be compared to the recipe's "south-indian" and match nothing.
  it("stores a typed cuisine as the slug a recipe carries", async () => {
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.addCuisine("South Indian"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ cuisines: ["south-indian"] }));
  });

  it("keeps the cuisines already stored when adding another", async () => {
    state.prefs = { cuisines: ["thai"] };
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.addCuisine("italian"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ cuisines: ["thai", "italian"] }));
  });

  it("does not re-send the list when the cuisine is already on it", () => {
    state.prefs = { cuisines: ["thai"] };
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.addCuisine("Thai"));

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("ignores an entry with nothing usable in it", () => {
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.addCuisine("  !! "));

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("removes a cuisine", async () => {
    state.prefs = { cuisines: ["thai", "italian"] };
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.removeCuisine("thai"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ cuisines: ["italian"] }));
  });

  it("reports the stored cook-time limit, and 0 for no opinion", () => {
    state.prefs = { cuisines: [], maxMinutes: 30 };
    expect(renderHook(() => useTastePreferences()).result.current.maxMinutes).toBe(30);

    state.prefs = { cuisines: [] };
    expect(renderHook(() => useTastePreferences()).result.current.maxMinutes).toBe(0);
  });

  it("saves a chosen cook-time limit", async () => {
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.setMaxMinutes(30));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ maxMinutes: 30 }));
  });

  // 0 is the wire value for "no opinion" — the one way to unset an optional
  // preference that otherwise merges on omission.
  it("clears the limit when the cook stops caring", async () => {
    state.prefs = { cuisines: [], maxMinutes: 30 };
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.setMaxMinutes(0));

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ maxMinutes: 0 }));
  });

  // Writing against the empty fallback would erase a stored taste the hook has
  // not seen yet.
  it("writes nothing while the stored preferences are still loading", () => {
    state.prefs = undefined;
    const { result } = renderHook(() => useTastePreferences());

    expect(result.current.loading).toBe(true);
    act(() => result.current.addCuisine("thai"));
    act(() => result.current.removeCuisine("thai"));
    act(() => result.current.setMaxMinutes(30));

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("reports a failed save rather than letting it pass for stored", async () => {
    saveMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useTastePreferences());

    act(() => result.current.addCuisine("thai"));

    await waitFor(() => expect(result.current.error).toBe("offline"));
  });
});
