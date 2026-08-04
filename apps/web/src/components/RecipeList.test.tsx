import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: {
      list: "recipes.list",
      remove: "recipes.remove",
      update: "recipes.update",
      listEquipment: "recipes.listEquipment",
    },
    basket: { add: "basket.add", remove: "basket.remove", updateTitle: "basket.updateTitle" },
    // The edit dialog loads the recipe's current prep so a derived task can be
    // overridden (BL-0044).
    prepTasks: { forRecipe: "prepTasks.forRecipe" },
    preferences: { get: "preferences.get" },
  },
}));

const {
  listRecipes,
  deleteRecipe,
  updateRecipe,
  listEquipment,
  prepForRecipe,
  rejectingMutation,
  household,
} = vi.hoisted(() => {
  const listRecipes = vi.fn();
  const deleteRecipe = vi.fn();
  const updateRecipe = vi.fn();
  // The edit dialog derives the recipe's prep so a rule can be overridden.
  const prepForRecipe = vi.fn(() => Promise.resolve({ tasks: [] }));
  // The equipment catalog is reference data every RecipeList render loads.
  const listEquipment = vi.fn(() => Promise.resolve([]));
  const m = vi.fn(() => Promise.reject(new Error("basket backend down"))) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: ReturnType<typeof vi.fn>;
  };
  m.withOptimisticUpdate = vi.fn(() => m);
  return {
    listRecipes,
    deleteRecipe,
    updateRecipe,
    listEquipment,
    prepForRecipe,
    rejectingMutation: m,
    household: { prefs: { householdSize: undefined } as { householdSize?: number } },
  };
});

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ref === "recipes.list"
      ? listRecipes
      : ref === "recipes.remove"
        ? deleteRecipe
        : ref === "recipes.listEquipment"
          ? listEquipment
          : ref === "prepTasks.forRecipe"
            ? prepForRecipe
            : updateRecipe,
  useMutation: () => rejectingMutation,
  useQuery: () => household.prefs,
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

// update replaces the whole recipe, so an edit that never touches the yield
// must still send it back — otherwise saving a title change silently clears
// the servings every downstream per-serving figure depends on (BL-0035).
describe("RecipeList edit preserves servings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // jsdom ships <dialog> without the modal methods, so opening the edit
    // dialog throws unless they are stubbed.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });

  it("resends the stored servings when only the title is edited", async () => {
    listRecipes.mockResolvedValue([{ ...RECIPE, servings: 6 }]);
    updateRecipe.mockResolvedValue(undefined);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Cheesy Bread" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ id: "r1", title: "Cheesy Bread", servings: 6 }),
      ),
    );
  });

  it("sends the edited servings when the user changes it", async () => {
    listRecipes.mockResolvedValue([{ ...RECIPE, servings: 6 }]);
    updateRecipe.mockResolvedValue(undefined);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText(/servings/i), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(expect.objectContaining({ servings: 8 })),
    );
  });

  it("clears the yield when the user blanks the field", async () => {
    listRecipes.mockResolvedValue([{ ...RECIPE, servings: 6 }]);
    updateRecipe.mockResolvedValue(undefined);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText(/servings/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(expect.objectContaining({ servings: undefined })),
    );
  });
});

// "Add to plan" is where household size earns its keep (BL-0018): the recipe's
// yield is known here, and the planner's stepper is one screen away, so the
// dial should already be right for the common case.
describe("RecipeList seeds the servings dial from household size", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    household.prefs = { householdSize: undefined };
  });

  it("scales a recipe that feeds fewer than the household", async () => {
    household.prefs = { householdSize: 4 };
    listRecipes.mockResolvedValue([{ ...RECIPE, servings: 2 }]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(rejectingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ recipeId: "r1", servingsMultiplier: 2 }),
      ),
    );
  });

  it("sends no multiplier when the household size is unset", async () => {
    listRecipes.mockResolvedValue([{ ...RECIPE, servings: 2 }]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(rejectingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ servingsMultiplier: undefined }),
      ),
    );
  });

  it("sends no multiplier when the recipe's yield is unknown", async () => {
    household.prefs = { householdSize: 4 };
    listRecipes.mockResolvedValue([RECIPE]);

    render(<RecipeList refreshKey={0} />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(rejectingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ servingsMultiplier: undefined }),
      ),
    );
  });
});
