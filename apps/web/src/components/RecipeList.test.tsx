import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A Convex mutation stub that rejects, with the .withOptimisticUpdate chain the
// component calls on the basket-remove mutation.
const { rejectingMutation } = vi.hoisted(() => {
  const fn = vi.fn(() => Promise.reject(new Error("basket backend down"))) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: ReturnType<typeof vi.fn>;
  };
  fn.withOptimisticUpdate = vi.fn(() => fn);
  return { rejectingMutation: fn };
});

vi.mock("convex/react", () => ({
  useMutation: () => rejectingMutation,
}));

vi.mock("../lib/recipeService", () => ({
  listRecipes: vi.fn(),
  deleteRecipe: vi.fn(),
  updateRecipe: vi.fn(),
}));

import { deleteRecipe, listRecipes } from "../lib/recipeService";
import { RecipeList } from "./RecipeList";

const RECIPE = {
  id: "r1",
  userId: "dev-user",
  title: "Garlic Bread",
  ingredients: [],
  createdAt: "2026-06-30T00:00:00.000Z",
};

describe("RecipeList cross-store delete consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("still refreshes the list and shows a targeted note when basket cleanup fails after delete", async () => {
    // Initial load returns the recipe; the post-delete refresh returns empty
    // (the recipe IS gone from the canonical store).
    vi.mocked(listRecipes).mockResolvedValueOnce([RECIPE]).mockResolvedValue([]);
    vi.mocked(deleteRecipe).mockResolvedValue(undefined);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // The recipe delete succeeded, so the list must reflect that even though the
    // basket mutation rejected — the row should disappear (refresh ran).
    await waitFor(() => expect(screen.queryByText("Garlic Bread")).toBeNull());

    // And the failure is surfaced as a targeted message, not swallowed and not a
    // generic "basket backend down".
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/basket/i);
    expect(alert.textContent).toContain("Garlic Bread");

    // refresh() actually ran after the failing basket op.
    expect(vi.mocked(listRecipes).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
