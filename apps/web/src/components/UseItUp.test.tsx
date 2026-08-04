import type { Recommendation } from "@pantry/types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PantryRow } from "../lib/expiry";

const DAY = 86_400_000;

const state = vi.hoisted(() => ({
  pantry: [] as unknown[],
  recommend: vi.fn(async () => [] as unknown[]),
  addToBasket: vi.fn(async () => undefined),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.pantry,
  useAction: () => state.recommend,
  useMutation: () => state.addToBasket,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

const { UseItUp } = await import("./UseItUp");

function row(over: Partial<PantryRow> = {}): PantryRow {
  return {
    _id: `p${over.canonicalItem ?? "x"}`,
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
    ...over,
  };
}

describe("UseItUp", () => {
  beforeEach(() => {
    state.pantry = [];
    state.recommend = vi.fn(async () => []);
    state.addToBasket = vi.fn(async () => undefined);
  });

  describe("as a nudge (Home)", () => {
    it("renders nothing when nothing is expiring — no zero badge, no empty state", () => {
      state.pantry = [row({ useBy: Date.now() + 60 * DAY })];
      const { container } = render(<UseItUp />);
      expect(container.innerHTML).toBe("");
    });

    // Home must stay an interrupt, and the gate is what keeps the common case
    // free: nothing expiring means no request at all.
    it("does not ask the ranker when there is nothing to nudge about", async () => {
      state.pantry = [row({ useBy: Date.now() + 60 * DAY })];
      render(<UseItUp />);
      await waitFor(() => expect(state.recommend).not.toHaveBeenCalled());
    });

    it("batches expiring items into a single prompt rather than per-item badges", async () => {
      state.pantry = [
        row({ canonicalItem: "spinach", display: "Spinach", useBy: Date.now() + 2 * DAY }),
        row({ canonicalItem: "milk", display: "Milk", useBy: Date.now() + 4 * DAY }),
        row({ canonicalItem: "bread", display: "Bread", useBy: Date.now() - DAY }),
      ];
      render(<UseItUp />);

      expect(await screen.findByText(/3 items to use this week/i)).toBeTruthy();
      expect(screen.getByText(/Spinach/)).toBeTruthy();
      expect(screen.getByText(/Milk/)).toBeTruthy();
    });

    it("says the dates are estimates", () => {
      state.pantry = [row()];
      render(<UseItUp />);
      expect(screen.getByText(/estimate/i)).toBeTruthy();
    });

    it("uses singular wording for one item", () => {
      state.pantry = [row()];
      render(<UseItUp />);
      expect(screen.getByText(/1 item to use this week/i)).toBeTruthy();
    });
  });

  describe("as the pantry page's card", () => {
    // /pantry is the feature's home, so the card is present whether or not
    // anything is spoiling — that is what lets it replace BOTH old cards.
    it("renders and asks even when nothing is expiring", async () => {
      state.pantry = [row({ useBy: Date.now() + 60 * DAY })];
      render(<UseItUp variant="page" />);

      expect(screen.getByRole("region", { name: /use it up/i })).toBeTruthy();
      await waitFor(() => expect(state.recommend).toHaveBeenCalled());
    });

    it("loads suggestions without waiting for a button press", async () => {
      state.pantry = [row()];
      state.recommend = vi.fn(async () => [rec()]);
      render(<UseItUp variant="page" />);

      expect(await screen.findByText("Creamed Spinach")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /what can i make/i })).toBeNull();
    });
  });

  it("offers the recipes it finds as the action", async () => {
    state.pantry = [row()];
    state.recommend = vi.fn(async () => [rec()]);
    render(<UseItUp />);

    expect(await screen.findByText("Creamed Spinach")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Creamed Spinach to plan/i })).toBeTruthy();
  });

  // The BL-0050 design point: urgency and preference fit are different claims,
  // so they must not render as one undifferentiated blob of reason text.
  it("renders urgency as its own line, separate from the fit reasons", async () => {
    state.pantry = [row()];
    const useBy = Date.now() + 2 * DAY;
    state.recommend = vi.fn(async () => [
      rec({
        urgency: { canonicalItem: "spinach", display: "Spinach", useBy },
        reasons: ["Uses 2 things you have"],
      }),
    ]);
    render(<UseItUp />);

    const urgent = await screen.findByText(/Use soon — Spinach/);
    const fit = screen.getByText(/Uses 2 things you have/);
    expect(urgent).toBeTruthy();
    // Distinct elements, not one merged string.
    expect(urgent).not.toBe(fit);
  });

  it("omits the urgency line when the ranker reports none", async () => {
    state.pantry = [row()];
    state.recommend = vi.fn(async () => [rec()]);
    render(<UseItUp />);

    expect(await screen.findByText("Creamed Spinach")).toBeTruthy();
    expect(screen.queryByText(/Use soon/)).toBeNull();
  });

  // Regression: the refetch key once omitted `useItUp`, so marking an item to
  // use up left the suggestions stale — which reads exactly like the flag doing
  // nothing, on the signal the ranker weights most heavily.
  it("re-asks the ranker when an item is marked to use up", async () => {
    // useBy is PINNED across both renders so the only thing that changes is the
    // flag. Letting row() default it to Date.now()+2d would move the key on its
    // own and the assertion would pass even with the bug present.
    const useBy = Date.now() + 2 * DAY;
    state.pantry = [row({ useBy, useItUp: false })];
    const { rerender } = render(<UseItUp variant="page" />);
    await waitFor(() => expect(state.recommend).toHaveBeenCalledTimes(1));

    state.pantry = [row({ useBy, useItUp: true })];
    rerender(<UseItUp variant="page" />);

    await waitFor(() => expect(state.recommend).toHaveBeenCalledTimes(2));
  });

  it("stays quiet when no recipe matches instead of showing a dead link", async () => {
    state.pantry = [row()];
    render(<UseItUp />);

    await waitFor(() => expect(state.recommend).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: /recipes/i })).toBeNull();
    expect(await screen.findByText(/no recipe/i)).toBeTruthy();
  });

  // Recommendations are additive: a dead ranker must not take the expiry
  // information with it, because that half came from local state.
  it("still shows the expiring items when the ranker fails", async () => {
    state.pantry = [row({ display: "Spinach" })];
    state.recommend = vi.fn(async () => {
      throw new Error("recipe-service down");
    });
    render(<UseItUp />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/1 item to use this week/i)).toBeTruthy();
    expect(screen.getByText(/Spinach/)).toBeTruthy();
  });
});
