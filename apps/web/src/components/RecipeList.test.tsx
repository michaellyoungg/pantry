import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { list: "recipes.list", remove: "recipes.remove", update: "recipes.update" },
    basket: { add: "basket.add", remove: "basket.remove", updateTitle: "basket.updateTitle" },
  },
}));

const { listRecipes, deleteRecipe, updateRecipe, rejectingMutation } = vi.hoisted(() => {
  const listRecipes = vi.fn();
  const deleteRecipe = vi.fn();
  const updateRecipe = vi.fn();
  const m = vi.fn(() => Promise.reject(new Error("basket backend down"))) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: ReturnType<typeof vi.fn>;
  };
  m.withOptimisticUpdate = vi.fn(() => m);
  return { listRecipes, deleteRecipe, updateRecipe, rejectingMutation: m };
});

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ref === "recipes.list" ? listRecipes : ref === "recipes.remove" ? deleteRecipe : updateRecipe,
  useMutation: () => rejectingMutation,
}));

import { RecipeList } from "./RecipeList";

const RECIPE = {
  id: "r1",
  userId: "user-a",
  title: "Garlic Bread",
  ingredients: [],
  createdAt: "2026-06-30T00:00:00.000Z",
};

describe("RecipeList cross-store delete consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still refreshes the list and shows a targeted note when basket cleanup fails after delete", async () => {
    listRecipes.mockResolvedValueOnce([RECIPE]).mockResolvedValue([]);
    deleteRecipe.mockResolvedValue(undefined);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete recipe" }));

    await waitFor(() => expect(screen.queryByText("Garlic Bread")).toBeNull());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/basket/i);
    expect(alert.textContent).toContain("Garlic Bread");

    expect(listRecipes.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not delete when the confirmation is cancelled", async () => {
    listRecipes.mockResolvedValue([RECIPE]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteRecipe).not.toHaveBeenCalled();
    expect(screen.getByText("Garlic Bread")).toBeTruthy();
  });
});

describe("RecipeList read-side states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state before recipes resolve (not the empty state)", () => {
    listRecipes.mockReturnValue(new Promise(() => {}));
    render(<RecipeList refreshKey={0} />);
    expect(screen.getByText(/loading recipes/i)).toBeTruthy();
    expect(screen.queryByText(/no recipes yet/i)).toBeNull();
  });

  it("shows an error with retry (not the empty state) when the load fails", async () => {
    listRecipes.mockRejectedValueOnce(new Error("recipes down")).mockResolvedValue([RECIPE]);
    render(<RecipeList refreshKey={0} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/recipes down/i);
    expect(screen.queryByText(/no recipes yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Garlic Bread");
  });
});

// Duplicate titles stay legal (BL-0013) — the recipe set is the user's, and
// two takes on "Chili" is a reasonable thing to want. What was missing is any
// way to SEE the collisions, which is what makes the list feel unmanageable.
describe("RecipeList duplicate titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags every member of a colliding title group, ignoring case and padding", async () => {
    listRecipes.mockResolvedValue([
      RECIPE,
      { ...RECIPE, id: "r2", title: "  garlic bread " },
      { ...RECIPE, id: "r3", title: "Soup" },
    ]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Soup");

    expect(screen.getAllByText("Duplicate")).toHaveLength(2);
  });

  it("leaves a list of unique titles unflagged", async () => {
    listRecipes.mockResolvedValue([RECIPE, { ...RECIPE, id: "r2", title: "Soup" }]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Soup");

    expect(screen.queryByText("Duplicate")).toBeNull();
  });

  it("still offers Edit and Delete on a duplicate so it can be cleaned up", async () => {
    listRecipes.mockResolvedValue([RECIPE, { ...RECIPE, id: "r2", title: "Garlic Bread" }]);

    render(<RecipeList refreshKey={0} />);
    await waitFor(() => expect(screen.getAllByText("Duplicate")).toHaveLength(2));

    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });
});
