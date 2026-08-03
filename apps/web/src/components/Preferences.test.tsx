import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Preferences } from "./Preferences";

const setPreferences = vi.fn();
// Mutable so individual tests can simulate the query still being in flight
// (convex/react's useQuery returns `undefined` until it resolves).
let queryResult: unknown = {
  avoidItems: ["peanut"],
  likedItems: [],
  dislikedItems: [],
  dietLabels: [],
};

vi.mock("convex/react", () => ({
  useQuery: () => queryResult,
  useMutation: () => setPreferences,
}));

vi.mock("@pantry/convex/api", () => ({ api: { preferences: { get: "get", set: "set" } } }));

describe("Preferences", () => {
  it("shows the current avoid list", () => {
    render(<Preferences />);
    // getByText throws if the element is absent, so a truthy assertion is
    // sufficient (this project's vitest setup does not load jest-dom matchers).
    expect(screen.getByText("peanut")).toBeTruthy();
  });

  it("adds an ingredient to the avoid list", async () => {
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "shellfish" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(setPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ avoidItems: ["peanut", "shellfish"] }),
      ),
    );
  });

  it("removes an ingredient from the avoid list", async () => {
    render(<Preferences />);

    fireEvent.click(screen.getByRole("button", { name: "Remove peanut" }));

    await waitFor(() =>
      expect(setPreferences).toHaveBeenCalledWith(expect.objectContaining({ avoidItems: [] })),
    );
  });

  it("explains that avoided ingredients are removed, not down-ranked, without overclaiming", () => {
    render(<Preferences />);
    expect(screen.getByText(/removed/i)).toBeTruthy();
    // The copy must not read as a blanket allergen guarantee: matching is
    // exact on ingredient name, so it must say so rather than imply "peanut"
    // also blocks "peanut butter".
    expect(screen.getByText(/peanut butter/i)).toBeTruthy();
  });

  // Regression: the Add/diet buttons were enabled while useQuery still
  // returned undefined. Clicking one saved `[...([]), value]`, wiping out
  // every already-stored avoid entry because `avoidItems` fell back to `[]`
  // before the real data arrived.
  it("disables the write controls while preferences are still loading", () => {
    queryResult = undefined;
    try {
      render(<Preferences />);
      expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "vegetarian" })).toHaveProperty("disabled", true);
    } finally {
      queryResult = { avoidItems: ["peanut"], likedItems: [], dislikedItems: [], dietLabels: [] };
    }
  });
});
