import type { RecommendationMissingItem } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UseItUpSuggestions } from "./UseItUpSuggestions";

const recommend = vi.fn();
const addToBasket = vi.fn();
/** The user's goal rows, as `api.nutritionTargets.list` would return them. */
let goals: unknown[] = [];

vi.mock("convex/react", () => ({
  useAction: () => recommend,
  useMutation: () => addToBasket,
  useQuery: () => goals,
}));
vi.mock("@pantry/convex/api", () => ({
  api: {
    recommendations: { pantry: "rec" },
    basket: { add: "add" },
    nutritionTargets: { list: "targets" },
  },
}));

describe("UseItUpSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    goals = [];
  });

  it("renders results with their reasons", async () => {
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Tomato Soup",
        source: "catalog",
        score: 0.8,
        reasons: ["Uses up: basil", "Uses 3 things you have"],
        have: ["tomato", "onion", "basil"],
        missing: [],
      },
    ]);

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText("Tomato Soup")).toBeTruthy();
    expect(screen.getByText(/Uses up: basil/)).toBeTruthy();
  });

  it("shows a helpful empty state rather than an error when nothing scores", async () => {
    recommend.mockResolvedValue([]);

    render(<UseItUpSuggestions />);
    // The empty message must not appear before a search has actually run.
    expect(screen.queryByText(/Nothing close yet/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText(/Nothing close yet/i)).toBeTruthy();
  });

  it("surfaces a failure without crashing the page", async () => {
    recommend.mockRejectedValue(new Error("service down"));

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText(/service down/)).toBeTruthy();
    // The page survives the failure: the search control is still usable.
    expect(screen.getByRole("button", { name: "What can I make?" })).toBeTruthy();
  });

  // Regression for BL-0005: a nil Go slice encodes to `null`, not `[]`, even
  // though the TS type declares `missing` as always an array. That crashed
  // the whole app (main.tsx's ErrorBoundary swallows the entire router) on
  // any fully-covered recipe. This is defence in depth for any other
  // producer that ships the same bug — the render must degrade, not throw.
  it("renders instead of throwing when a producer sends missing: null", async () => {
    recommend.mockResolvedValue([
      {
        recipeId: "full",
        title: "Fully Covered",
        source: "catalog",
        score: 1,
        reasons: ["You have everything"],
        have: ["rice", "garlic"],
        missing: null as unknown as RecommendationMissingItem[],
      },
    ]);

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText("Fully Covered")).toBeTruthy();
  });

  it("adds a suggestion to the plan", async () => {
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Tomato Soup",
        source: "catalog",
        score: 0.8,
        reasons: [],
        have: ["tomato"],
        missing: [],
      },
    ]);

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Tomato Soup to plan" }));

    await waitFor(() =>
      expect(addToBasket).toHaveBeenCalledWith({ recipeId: "r1", title: "Tomato Soup" }),
    );
  });

  // BL-0040. A hard constraint shortens this list, and a list that silently
  // shrank looks exactly like one with nothing to suggest.
  it("says when required goals are removing recipes", () => {
    goals = [
      { nutrientId: "1253", operator: "<=", value: 200, period: "meal", active: true, hard: true },
      { nutrientId: "1003", operator: ">=", value: 150, period: "day", active: true },
    ];

    render(<UseItUpSuggestions />);

    expect(screen.getByText(/Hiding recipes that break your required goal\b/)).toBeTruthy();
  });

  it("stays quiet when every goal is only a preference", () => {
    goals = [
      { nutrientId: "1003", operator: ">=", value: 150, period: "day", active: true },
      // Paused, and hard — a paused goal filters nothing.
      { nutrientId: "1253", operator: "<=", value: 200, period: "meal", active: false, hard: true },
    ];

    render(<UseItUpSuggestions />);

    expect(screen.queryByText(/Hiding recipes/)).toBeNull();
  });

  // The coverage-honesty rule, at the surface: an unmapped recipe is still
  // suggested, but never as though it had cleared a limit nobody checked.
  it("marks a suggestion that could not be checked against a required goal", async () => {
    goals = [
      { nutrientId: "1253", operator: "<=", value: 200, period: "meal", active: true, hard: true },
    ];
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Mystery Bowl",
        source: "catalog",
        score: 0.5,
        reasons: [],
        have: ["rice"],
        missing: [],
        nutritionFit: null,
        nutritionUnverified: [{ nutrientId: "1253" }],
      },
    ]);

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText(/Not checked against: Cholesterol/)).toBeTruthy();
  });

  it("says nothing about nutrition for a recipe that was measured", async () => {
    recommend.mockResolvedValue([
      {
        recipeId: "r1",
        title: "Rice Bowl",
        source: "catalog",
        score: 0.9,
        reasons: ["Fits your nutrition goals"],
        have: ["rice"],
        missing: [],
        nutritionFit: 0.9,
        nutritionUnverified: [],
      },
    ]);

    render(<UseItUpSuggestions />);
    fireEvent.click(screen.getByRole("button", { name: "What can I make?" }));

    expect(await screen.findByText("Rice Bowl")).toBeTruthy();
    expect(screen.queryByText(/Not checked against/)).toBeNull();
  });
});
