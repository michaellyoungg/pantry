// @vitest-environment jsdom
import type { GeneratedRecipeDraft, Recommendation } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;

const state = vi.hoisted(() => ({
  pantry: [] as unknown[],
  recommend: vi.fn(async () => ({ results: [], generated: [] }) as unknown),
  accept: vi.fn(async () => ({ id: "saved-1", title: "Saved" }) as unknown),
  addToBasket: vi.fn(async () => undefined),
}));

// Two actions, so the mock has to tell them apart. anyApi references are fresh
// proxies on every access, so identity comparison would silently always pick
// the same branch; the function NAME is stable.
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => state.pantry,
    useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref) === "recommendations:acceptGenerated" ? state.accept : state.recommend,
    useMutation: () => state.addToBasket,
  };
});

const { useUseItUp } = await import("./useUseItUp");

function row(over: Record<string, unknown> = {}) {
  return {
    _id: `p${(over.canonicalItem as string) ?? "x"}`,
    display: "Spinach",
    canonicalItem: "spinach",
    state: "have",
    useBy: Date.now() + 2 * DAY,
    ...over,
  };
}

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    recipeId: "r1",
    title: "Creamed Spinach",
    source: "catalog",
    score: 0.9,
    reasons: ["Uses 2 things you have"],
    have: ["spinach"],
    missing: [],
    nutritionFit: null,
    nutritionUnverified: [],
    ...over,
  };
}

function ranked(results: Recommendation[] = [], generated: GeneratedRecipeDraft[] = []) {
  return async () => ({ results, generated });
}

// This suite MUST unmount between tests, and it is the first one here that
// does. Vitest is not running with `globals: true`, so RTL never registers its
// automatic cleanup — and unlike the other data hooks, this one owns an async
// effect. A hook left mounted re-renders when its promise settles in the *next*
// test, reads that test's pantry, sees a changed refetch key and fires a
// request nobody asked for. Without this the failure looks like a bug in the
// refetch key rather than in the harness.
afterEach(cleanup);

beforeEach(() => {
  state.pantry = [];
  state.recommend.mockReset().mockImplementation(ranked());
  state.accept.mockReset().mockImplementation(async () => ({ id: "saved-1", title: "Saved" }));
  state.addToBasket.mockReset().mockImplementation(async () => undefined);
});

describe("the expiring batch", () => {
  it("is derived locally, so it is populated before the ranker answers", () => {
    state.pantry = [row({ canonicalItem: "spinach", useBy: Date.now() + 2 * DAY })];
    state.recommend.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useUseItUp("page"));

    expect(result.current.loading).toBe(true);
    expect(result.current.batch.map((r) => r.canonicalItem)).toEqual(["spinach"]);
  });

  it("applies the shared horizon rather than a second copy of it", () => {
    state.pantry = [
      row({ canonicalItem: "spinach", useBy: Date.now() + 2 * DAY }),
      row({ canonicalItem: "rice", useBy: Date.now() + 300 * DAY }),
      row({ canonicalItem: "milk", useBy: Date.now() + DAY, state: "out" }),
      row({ canonicalItem: "salt", useBy: undefined }),
    ];

    const { result } = renderHook(() => useUseItUp("page"));

    // Out-of-horizon, already-`out`, and undated rows are all excluded — the
    // rules live in @pantry/core/expiry and are asserted there.
    expect(result.current.batch.map((r) => r.canonicalItem)).toEqual(["spinach"]);
  });
});

describe("the nudge gate", () => {
  it("goes silent and costs no request when nothing is expiring", async () => {
    state.pantry = [row({ useBy: Date.now() + 300 * DAY })];

    const { result } = renderHook(() => useUseItUp("nudge"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.silent).toBe(true);
    expect(state.recommend).not.toHaveBeenCalled();
  });

  it("stays loud on the pantry page, which is the feature's home", async () => {
    state.pantry = [row({ useBy: Date.now() + 300 * DAY })];

    const { result } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(state.recommend).toHaveBeenCalled());
    expect(result.current.silent).toBe(false);
    expect(result.current.batch).toEqual([]);
  });
});

describe("refetching", () => {
  it("re-asks when an item is marked to use up", async () => {
    state.pantry = [row({ canonicalItem: "spinach", useItUp: false })];
    const { rerender } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(state.recommend).toHaveBeenCalledTimes(1));

    // The flag is the strongest signal the ranker reads. If it were left out of
    // the refetch key, marking an item would look like it did nothing.
    state.pantry = [row({ canonicalItem: "spinach", useItUp: true })];
    rerender();

    await waitFor(() => expect(state.recommend).toHaveBeenCalledTimes(2));
  });

  it("does not re-ask when the pantry is unchanged", async () => {
    // Pinned, not `row()`'s relative default: the key includes `useBy`, so a
    // freshly stamped date is a genuinely different pantry and *should* re-ask.
    const useBy = Date.now() + 2 * DAY;
    state.pantry = [row({ canonicalItem: "spinach", useBy })];
    const { rerender } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(state.recommend).toHaveBeenCalledTimes(1));

    // A fresh array of equal rows every render is the normal Convex case; a
    // reference-keyed effect would re-request forever.
    state.pantry = [row({ canonicalItem: "spinach", useBy })];
    rerender();
    rerender();

    expect(state.recommend).toHaveBeenCalledTimes(1);
  });
});

describe("adding to the plan", () => {
  it("puts a catalog suggestion straight on the plan", async () => {
    state.pantry = [row()];
    state.recommend.mockImplementation(ranked([rec()]));
    const { result } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    act(() => result.current.addToPlan(rec()));

    await waitFor(() =>
      expect(state.addToBasket).toHaveBeenCalledWith({
        recipeId: "r1",
        title: "Creamed Spinach",
      }),
    );
    expect(state.accept).not.toHaveBeenCalled();
  });

  it("saves a generated idea first, because the plan holds real recipe ids", async () => {
    const draft: GeneratedRecipeDraft = {
      recipeId: "gen-1",
      title: "Spinach Skillet",
      servings: 2,
      ingredients: [{ item: "spinach", quantity: 1, unit: "bunch" }],
      steps: ["Wilt it."],
    };
    state.pantry = [row()];
    state.recommend.mockImplementation(
      ranked([rec({ recipeId: "gen-1", title: "Spinach Skillet", source: "generated" })], [draft]),
    );
    const { result } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    const suggestion = result.current.suggestions?.[0] as Recommendation;
    act(() => result.current.addToPlan(suggestion));

    await waitFor(() => expect(state.accept).toHaveBeenCalled());
    // The SAVED id, never the synthetic `gen-` one, which names no stored recipe.
    expect(state.addToBasket).toHaveBeenCalledWith({ recipeId: "saved-1", title: "Saved" });
  });

  it("surfaces a failed add instead of swallowing it", async () => {
    state.pantry = [row()];
    state.recommend.mockImplementation(ranked([rec()]));
    state.addToBasket.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    act(() => result.current.addToPlan(rec()));

    await waitFor(() => expect(result.current.addError).toContain("offline"));
    // A failed add is not a failed load: the card itself is fine.
    expect(result.current.error).toBeNull();
  });
});

describe("failure", () => {
  it("keeps the local batch when the ranker is down", async () => {
    state.pantry = [row({ canonicalItem: "spinach" })];
    state.recommend.mockRejectedValue(new Error("ranker down"));

    const { result } = renderHook(() => useUseItUp("page"));

    await waitFor(() => expect(result.current.error).toContain("ranker down"));
    expect(result.current.suggestions).toBeUndefined();
    // Recommendations are additive and must never take the card down with them.
    expect(result.current.batch.map((r) => r.canonicalItem)).toEqual(["spinach"]);
  });
});
