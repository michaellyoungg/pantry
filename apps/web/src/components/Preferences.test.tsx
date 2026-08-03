import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Preferences } from "./Preferences";

const setPreferences = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => ({ avoidItems: ["peanut"], likedItems: [], dislikedItems: [], dietLabels: [] }),
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

  it("explains that avoided ingredients are removed, not down-ranked", () => {
    render(<Preferences />);
    expect(screen.getByText(/never suggested/i)).toBeTruthy();
  });
});
