import type { Recommendation } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The mutation mocks are typed with their argument so the assertions below can
// read `mock.calls`. An untyped `vi.fn(async () => …)` has a zero-length tuple
// for its calls, which typechecks as "no such argument".
type ShownArgs = { context: string; recipes: { recipeId: string; canonicalItems: string[] }[] };
type EventArgs = {
  recipeId: string;
  context: string;
  action: string;
  canonicalItems?: string[];
};

const state = vi.hoisted(() => ({
  discover: vi.fn(async () => [] as unknown),
  record: vi.fn(async (_args: unknown) => undefined),
  recordShown: vi.fn(async (_args: unknown) => undefined),
  addToBasket: vi.fn(async (_args: unknown) => undefined),
}));

// `anyApi` references are fresh proxies on every property access, so comparing
// them by identity would silently always take the same branch. The function NAME
// is the stable thing (BL-0034 learned this the hard way).
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: () => state.discover,
    useMutation: (ref: Parameters<typeof import("convex/server").getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "recommendationEvents:record") return state.record;
      if (name === "recommendationEvents:recordShownBatch") return state.recordShown;
      return state.addToBasket;
    },
  };
});

// `href` matters: an anchor without one has no implicit `link` role, and the
// assertions below query by role because that is what a screen reader sees.
// `search` is dropped rather than spread — it is an object, and React would
// render it onto the DOM as "[object Object]".
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { ForYou } = await import("./ForYou");

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    recipeId: "r1",
    title: "Green Curry",
    source: "catalog",
    score: 0.8,
    reasons: ["Uses things you cook a lot"],
    have: ["garlic"],
    missing: [{ canonicalItem: "coconut milk", display: "Coconut milk" }],
    ...over,
  };
}

describe("ForYou", () => {
  beforeEach(() => {
    state.discover = vi.fn(async () => []);
    state.record = vi.fn(async (_args: unknown) => undefined);
    state.recordShown = vi.fn(async (_args: unknown) => undefined);
    state.addToBasket = vi.fn(async (_args: unknown) => undefined);
  });

  it("renders the ranked suggestions with their reasons", async () => {
    state.discover = vi.fn(async () => [rec()]);
    render(<ForYou />);

    expect(await screen.findByRole("link", { name: "Green Curry" })).toBeTruthy();
    expect(screen.getByText("Uses things you cook a lot")).toBeTruthy();
    expect(screen.getByText("Need: Coconut milk")).toBeTruthy();
  });

  // Empty is a first-class state and says what to do about it. With a small
  // catalog "nothing new" is a normal Tuesday, not a failure.
  it("offers a way forward when there is nothing to suggest", async () => {
    render(<ForYou />);
    expect(await screen.findByText(/Nothing new to suggest/)).toBeTruthy();
  });

  it("degrades to a message rather than breaking the page when the ranker fails", async () => {
    state.discover = vi.fn(async () => {
      throw new Error("boom");
    });
    render(<ForYou />);
    expect(await screen.findByText(/Couldn't load suggestions/)).toBeTruthy();
  });

  describe("the interaction log", () => {
    // Impressions are the whole reason `shown` events exist: without them a
    // small catalog shows the same card forever.
    it("logs the rendered batch as shown, with its canonical ingredients", async () => {
      state.discover = vi.fn(async () => [rec()]);
      render(<ForYou />);

      await screen.findByRole("link", { name: "Green Curry" });
      await waitFor(() => expect(state.recordShown).toHaveBeenCalled());
      expect(state.recordShown.mock.calls[0][0] as ShownArgs).toEqual({
        context: "discover",
        recipes: [{ recipeId: "r1", canonicalItems: ["garlic", "coconut milk"] }],
      });
    });

    it("does not log an impression for an empty batch", async () => {
      render(<ForYou />);
      await screen.findByText(/Nothing new to suggest/);
      expect(state.recordShown).not.toHaveBeenCalled();
    });

    it("records an accepted event when a suggestion goes on the plan", async () => {
      state.discover = vi.fn(async () => [rec()]);
      render(<ForYou />);

      fireEvent.click(await screen.findByRole("button", { name: "Add Green Curry to plan" }));

      await waitFor(() => expect(state.addToBasket).toHaveBeenCalled());
      expect(state.record.mock.calls[0][0] as EventArgs).toEqual({
        recipeId: "r1",
        context: "discover",
        action: "accepted",
        canonicalItems: ["garlic", "coconut milk"],
      });
    });

    // The user answered the question. Leaving the row on screen while the log
    // records the answer makes the button look broken.
    it("records a dismissal and hides the row immediately", async () => {
      state.discover = vi.fn(async () => [rec(), rec({ recipeId: "r2", title: "Laksa" })]);
      render(<ForYou />);

      fireEvent.click(await screen.findByRole("button", { name: "Not for me: Green Curry" }));

      await waitFor(() => expect(screen.queryByRole("link", { name: "Green Curry" })).toBeNull());
      expect(screen.getByRole("link", { name: "Laksa" })).toBeTruthy();
      expect(state.record.mock.calls[0][0] as EventArgs).toEqual({
        recipeId: "r1",
        context: "discover",
        action: "dismissed",
        canonicalItems: ["garlic", "coconut milk"],
      });
    });

    // Dismissing everything is not an error state; it is the empty state.
    it("falls back to the empty state once everything is dismissed", async () => {
      state.discover = vi.fn(async () => [rec()]);
      render(<ForYou />);

      fireEvent.click(await screen.findByRole("button", { name: "Not for me: Green Curry" }));

      expect(await screen.findByText(/Nothing new to suggest/)).toBeTruthy();
    });

    // Losing an impression costs a little novelty accuracy and nothing else. It
    // must never surface on a card the user did not ask for.
    it("stays silent when logging an impression fails", async () => {
      state.discover = vi.fn(async () => [rec()]);
      state.recordShown = vi.fn(async (_args: unknown) => {
        throw new Error("offline");
      });
      render(<ForYou />);

      await screen.findByRole("link", { name: "Green Curry" });
      expect(screen.queryByText(/Couldn't/)).toBeNull();
    });
  });

  // A nil Go slice marshals to `null` even though the type says it cannot, and
  // that has crashed the whole app once already.
  it("survives a payload whose missing list is null", async () => {
    state.discover = vi.fn(async () => [{ ...rec(), missing: null } as unknown as Recommendation]);
    render(<ForYou />);

    expect(await screen.findByRole("link", { name: "Green Curry" })).toBeTruthy();
    expect(screen.queryByText(/^Need:/)).toBeNull();
  });
});
