// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedItem } from "../planner";

// One spy per mutation, dispatched on the api ref's function name: `add` and
// `schedule` are called back to back for every pick, so a shared spy could not
// say which of the two a given call was.
const { fetchCandidates, addMock, scheduleMock } = vi.hoisted(() => ({
  fetchCandidates: vi.fn(),
  addMock: vi.fn(() => Promise.resolve()),
  scheduleMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: () => fetchCandidates,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).endsWith("add") ? addMock : scheduleMock,
  };
});

import { useWeekSuggestion } from "./useWeekSuggestion";

function candidate(recipeId: string, score: number, missing: string[] = [], have: string[] = []) {
  return {
    recipeId,
    title: `Recipe ${recipeId}`,
    source: "catalog" as const,
    score,
    reasons: [],
    have,
    missing: missing.map((canonicalItem) => ({ canonicalItem, display: canonicalItem })),
  };
}

const planned = (over: Partial<PlannedItem>): PlannedItem => ({
  _id: "b1",
  recipeId: "r1",
  title: "Toast",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchCandidates.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("useWeekSuggestion", () => {
  it("has nothing to show until it is asked", () => {
    const { result } = renderHook(() => useWeekSuggestion([]));

    expect(result.current.proposal).toBeNull();
    expect(fetchCandidates).not.toHaveBeenCalled();
  });

  it("proposes a day for each pick, in calendar order", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9, ["chicken"]), candidate("b", 0.8)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(result.current.proposal?.picks.map((p) => p.weekday)).toEqual([0, 1]);
  });

  it("leaves a day the user has already planned alone", async () => {
    // The non-destructive rule: pressing a button that offered you more must
    // never cost you the Wednesday you had already decided on.
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    const { result } = renderHook(() => useWeekSuggestion([planned({ weekday: 2 })]));
    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(result.current.proposal?.lockedWeekdays).toEqual([2]);
    expect(result.current.proposal?.picks.map((p) => p.weekday)).not.toContain(2);
  });

  it("writes nothing while a proposal is merely on offer", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(addMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("baskets and schedules every pick on accept, then clears the offer", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());

    await act(async () => result.current.accept());

    await waitFor(() => expect(result.current.proposal).toBeNull());
    expect(addMock).toHaveBeenCalledWith({ recipeId: "a", title: "Recipe a" });
    expect(scheduleMock).toHaveBeenCalledWith({ recipeId: "a", weekday: 0 });
  });

  it("drops one dinner and refills its day from what is left", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9), candidate("b", 0.8)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());

    await act(async () => result.current.dropPick("a"));

    expect(result.current.proposal?.picks.map((p) => p.recipeId)).toEqual(["b"]);
    // No second round trip: the pool is fetched once and reused for edits.
    expect(fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it("offers a genuinely different week on 'try again'", async () => {
    // Selection is deterministic, so re-running it unchanged would hand back the
    // identical week and read as a dead button.
    fetchCandidates.mockResolvedValue([candidate("a", 0.9), candidate("b", 0.8)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(result.current.proposal?.picks[0].recipeId).toBe("a");

    await act(async () => result.current.regenerate());

    expect(result.current.proposal?.picks.map((p) => p.recipeId)).not.toContain("a");
  });

  it("throws the proposal away without writing anything", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());

    await act(async () => result.current.discard());

    expect(result.current.proposal).toBeNull();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("re-asks the server after a discard, since the pool went with it", async () => {
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    await act(async () => result.current.discard());

    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(fetchCandidates).toHaveBeenCalledTimes(2);
  });

  it("reports an empty proposal rather than nothing at all", async () => {
    // An empty answer is a real answer, and the view says which of its two
    // causes applies — so it has to be able to tell "not asked yet" from
    // "asked, and there is nothing".
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(result.current.proposal?.picks).toEqual([]);
  });

  it("surfaces a failed fetch as an error string rather than throwing", async () => {
    fetchCandidates.mockRejectedValueOnce(new Error("recommender is down"));
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());

    await waitFor(() => expect(result.current.error).toBe("recommender is down"));
    expect(result.current.proposal).toBeNull();
  });

  it("surfaces a failed accept and keeps the proposal on screen", async () => {
    // Half a week may have landed, so the offer stays: discarding it would hide
    // what the user still has to finish.
    fetchCandidates.mockResolvedValue([candidate("a", 0.9)]);
    addMock.mockRejectedValueOnce(new Error("basket is down") as never);
    const { result } = renderHook(() => useWeekSuggestion([]));
    await act(async () => result.current.suggest());
    await waitFor(() => expect(result.current.proposal).not.toBeNull());

    await act(async () => result.current.accept());

    await waitFor(() => expect(result.current.error).toBe("basket is down"));
    expect(result.current.proposal).not.toBeNull();
  });
});
