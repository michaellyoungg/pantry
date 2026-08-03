import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UseItUpSuggestions } from "./UseItUpSuggestions";

const recommend = vi.fn();
const addToBasket = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => recommend,
  useMutation: () => addToBasket,
}));
vi.mock("@pantry/convex/api", () => ({
  api: { recommendations: { pantry: "rec" }, basket: { add: "add" } },
}));

describe("UseItUpSuggestions", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
