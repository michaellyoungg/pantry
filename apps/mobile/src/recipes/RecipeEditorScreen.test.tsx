import type { EquipmentDef, PrepMeal, Recipe } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * The one review-and-edit surface, both ways round.
 *
 * The claim worth testing here is BL-0020's rule: a parse is NEVER saved
 * silently. So the import test asserts on what reached the fields *and* on what
 * did not reach the server.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockCreate = jest.fn(async () => ({}) as unknown);
const mockImport = jest.fn(async () => ({}) as unknown);
const mockUpdate = jest.fn(async () => undefined as unknown);
const mockGet = jest.fn(async () => null as unknown);
const mockForRecipe = jest.fn(async () => null as unknown);
const mockListEquipment = jest.fn(async () => [] as unknown);
const mockBack = jest.fn();

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useAction: (ref: unknown) => {
      const name = getFunctionName(ref);
      if (name === "recipes:create") return mockCreate;
      if (name === "recipes:importFromUrl") return mockImport;
      if (name === "recipes:update") return mockUpdate;
      if (name === "recipes:get") return mockGet;
      if (name === "recipes:listEquipment") return mockListEquipment;
      return mockForRecipe;
    },
    useMutation: () => jest.fn(async () => undefined),
  };
});

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "r1" }),
  useRouter: () => ({ back: mockBack, navigate: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Not colocated with the routes on purpose — see appRouteTree.test.ts.
import EditRecipeRoute from "../../app/recipe/[id]/edit";
import NewRecipeRoute from "../../app/recipes/new";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Chilli",
    servings: 4,
    ingredients: [{ item: "beans", quantity: 1, unit: "tin" }],
    steps: ["Simmer."],
    equipment: [],
    methods: [],
    cuisine: "mexican",
    totalMinutes: 45,
    tags: ["weeknight"],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const SMOKER: EquipmentDef = { id: "smoker", name: "Smoker", category: "appliance", aliases: [] };

const prep = (tasks: PrepMeal["tasks"]): PrepMeal => ({
  recipeId: "r1",
  title: "Chilli",
  cookDate: "2026-08-05",
  tasks,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(recipe({ id: "new-1" }));
  mockImport.mockResolvedValue(recipe({ id: "preview", title: "Imported Chilli" }));
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockResolvedValue(recipe());
  mockForRecipe.mockResolvedValue(prep([]));
  mockListEquipment.mockResolvedValue([SMOKER]);
});

describe("adding a recipe", () => {
  it("cannot be saved until it has a title", async () => {
    await render(<NewRecipeRoute />);

    expect(screen.getByTestId("recipes.save").props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli");
    expect(screen.getByTestId("recipes.save").props.accessibilityState.disabled).toBe(false);
  });

  it("creates the recipe and returns to where it was opened from", async () => {
    await render(<NewRecipeRoute />);
    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli");
    await fireEvent.changeText(screen.getByTestId("recipes.field-servings"), "4");
    await fireEvent.press(screen.getByTestId("recipes.save"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Chilli", servings: 4 }),
      ),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("stays put when the create fails, so the typing is not lost", async () => {
    mockCreate.mockRejectedValueOnce(new Error("400 bad recipe"));

    await render(<NewRecipeRoute />);
    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli");
    await fireEvent.press(screen.getByTestId("recipes.save"));

    expect(await screen.findByTestId("recipes.editor-error")).toHaveTextContent(/400 bad recipe/);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("edits a list in place", async () => {
    await render(<NewRecipeRoute />);
    await fireEvent.press(screen.getByTestId("recipes.add-step"));
    await fireEvent.changeText(screen.getByTestId("recipes.field-step.row-1"), "Heat the oven.");
    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli");
    await fireEvent.press(screen.getByTestId("recipes.save"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ steps: ["Heat the oven."] }),
      ),
    );
  });

  it("records equipment, which is what makes the catalog's fit filter mean anything", async () => {
    await render(<NewRecipeRoute />);
    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli");
    await fireEvent.press(await screen.findByTestId("recipes.equipment-tag.smoker"));
    await fireEvent.press(screen.getByTestId("recipes.save"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: [{ id: "smoker", required: true }] }),
      ),
    );
  });

  it("cycles an equipment tag required → optional → gone", async () => {
    await render(<NewRecipeRoute />);
    const tag = await screen.findByTestId("recipes.equipment-tag.smoker");

    await fireEvent.press(tag);
    expect(tag).toHaveTextContent(/^Smoker$/);

    await fireEvent.press(tag);
    expect(tag).toHaveTextContent(/optional/);

    await fireEvent.press(tag);
    expect(tag.props.accessibilityState.selected).toBe(false);
  });
});

describe("importing from a URL", () => {
  it("fills the fields for review and saves nothing", async () => {
    await render(<NewRecipeRoute />);
    await fireEvent.changeText(
      screen.getByTestId("recipes.import-url"),
      "https://example.test/chilli",
    );
    await fireEvent.press(screen.getByTestId("recipes.import-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("recipes.field-title").props.value).toBe("Imported Chilli"),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("will not fire on an empty box", async () => {
    await render(<NewRecipeRoute />);

    expect(screen.getByTestId("recipes.import-submit").props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it("keeps what is already typed when the page will not parse", async () => {
    mockImport.mockRejectedValueOnce(new Error("could not read that page"));

    await render(<NewRecipeRoute />);
    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "My own title");
    await fireEvent.changeText(screen.getByTestId("recipes.import-url"), "https://example.test/x");
    await fireEvent.press(screen.getByTestId("recipes.import-submit"));

    expect(await screen.findByTestId("recipes.import-error")).toHaveTextContent(/could not read/);
    expect(screen.getByTestId("recipes.field-title").props.value).toBe("My own title");
  });
});

describe("editing a stored recipe", () => {
  it("seeds the fields from what is stored", async () => {
    await render(<EditRecipeRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("recipes.field-title").props.value).toBe("Chilli"),
    );
    expect(screen.getByTestId("recipes.field-servings").props.value).toBe("4");
    expect(screen.getByTestId("recipes.field-cuisine").props.value).toBe("mexican");
  });

  it("offers no import box — re-importing would overwrite the corrections", async () => {
    await render(<EditRecipeRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("recipes.field-title").props.value).toBe("Chilli"),
    );
    expect(screen.queryByTestId("recipes.import-url")).toBeNull();
  });

  it("sends every field, because update replaces the recipe", async () => {
    await render(<EditRecipeRoute />);
    await waitFor(() =>
      expect(screen.getByTestId("recipes.field-title").props.value).toBe("Chilli"),
    );

    await fireEvent.changeText(screen.getByTestId("recipes.field-title"), "Chilli con carne");
    await fireEvent.press(screen.getByTestId("recipes.save"));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "r1",
          title: "Chilli con carne",
          servings: 4,
          cuisine: "mexican",
          tags: ["weeknight"],
        }),
      ),
    );
  });

  it("says a deleted recipe is gone rather than offering an empty form", async () => {
    mockGet.mockResolvedValue(null);

    await render(<EditRecipeRoute />);

    expect(await screen.findByTestId("recipes.editor-missing")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.save")).toBeNull();
  });

  it("offers a derived prep task for override, carrying its key across", async () => {
    // The key is the mechanism: without it the server would show both.
    mockForRecipe.mockResolvedValue(
      prep([
        {
          key: "thaw:beef",
          ruleId: "thaw_frozen_protein",
          subject: "beef",
          window: "night_before",
          text: "Thaw the beef",
          dueOn: "2026-08-04",
          source: "rule",
        },
      ]),
    );

    await render(<EditRecipeRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.prep-override.thaw-beef"));
    await fireEvent.press(screen.getByTestId("recipes.save"));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          prepTasks: [{ key: "thaw:beef", window: "night_before", text: "Thaw the beef" }],
        }),
      ),
    );
  });
});
