import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByText("peanut")).toBeInTheDocument();
  });

  it("adds an ingredient to the avoid list", async () => {
    const user = userEvent.setup();
    render(<Preferences />);

    await user.type(screen.getByPlaceholderText("Ingredient to avoid"), "shellfish");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(setPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ avoidItems: ["peanut", "shellfish"] }),
    );
  });

  it("removes an ingredient from the avoid list", async () => {
    const user = userEvent.setup();
    render(<Preferences />);

    await user.click(screen.getByRole("button", { name: "Remove peanut" }));

    expect(setPreferences).toHaveBeenCalledWith(expect.objectContaining({ avoidItems: [] }));
  });

  it("explains that avoided ingredients are removed, not down-ranked", () => {
    render(<Preferences />);
    expect(screen.getByText(/never suggested/i)).toBeInTheDocument();
  });
});
