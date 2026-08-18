import type { EquipmentDef, PrepMeal, Recipe } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * `convex/react` is mocked; `useRecipeDetail()` is not. The screen is
 * presentation over the shared hook, so what is worth proving is that a real
 * recipe, its real derived prep and a real catalog lookup reach the screen —
 * and that each of the three failing independently leaves the rest readable.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockGetRecipe = jest.fn(async () => null as unknown);
const mockForRecipe = jest.fn(async () => null as unknown);
const mockListEquipment = jest.fn(async () => [] as unknown);
const mockNutrition = jest.fn(async () => null as unknown);
const mockNavigate = jest.fn();
const mockBack = jest.fn();

jest.mock("convex/react", () => {
  // Function references are lazily-built proxies, so identity comparison is not
  // reliable — the function's name is.
  const { getFunctionName } = require("convex/server");
  return {
    useAction: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "recipes:get") return mockGetRecipe;
      if (name === "recipes:listEquipment") return mockListEquipment;
      if (name === "recipes:nutrition") return mockNutrition;
      return mockForRecipe;
    },
    // The nutrition panel's goals (BL-0065). No goal is the ordinary state, and
    // this suite is about the recipe rather than about the panel.
    useQuery: () => [],
  };
});

// The route module under test reads its own id, and routing is the screen's
// concern (rule 5 keeps routers out of shared code).
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "r1" }),
  useRouter: () => ({ navigate: mockNavigate, back: mockBack }),
}));

// The stack renders no header, so the screen reads the top inset itself. There
// is no native safe-area module in a Node test process.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// The screen under test is the route module itself. The test deliberately does
// NOT live next to it: every file under `app/` is bundled into the app, and a
// test file drags `@testing-library/react-native` in with it. See
// `src/testing/appRouteTree.test.ts`.
import RecipeRoute from "../../app/recipe/[id]";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Roast turkey",
    ingredients: [{ item: "turkey", quantity: 1, unit: "whole" }],
    steps: ["Heat the oven.", "Roast it.", "Rest it."],
    equipment: [],
    methods: ["roast"],
    tags: [],
    prepTasks: [],
    totalMinutes: 90,
    cuisine: "british",
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function prep(tasks: PrepMeal["tasks"]): PrepMeal {
  return { recipeId: "r1", title: "Roast turkey", cookDate: "2026-08-05", tasks };
}

const THAW = {
  key: "thaw_frozen_protein:turkey",
  ruleId: "thaw_frozen_protein",
  subject: "turkey",
  window: "night_before" as const,
  text: "Move the turkey to the fridge to thaw",
  source: "rule" as const,
  dueOn: "2026-08-04",
};

const OVEN: EquipmentDef = { id: "oven", name: "Oven", category: "appliance", aliases: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRecipe.mockResolvedValue(recipe());
  mockForRecipe.mockResolvedValue(prep([]));
  mockListEquipment.mockResolvedValue([OVEN]);
});

describe("the recipe route", () => {
  it("is a real screen, reached by id", async () => {
    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.detail-title")).toHaveTextContent("Roast turkey");
    expect(mockGetRecipe).toHaveBeenCalledWith({ id: "r1" });
  });

  it("leads with what the cook needs to decide with", async () => {
    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.detail-meta")).toHaveTextContent(
      /1 h 30 min · British/,
    );
  });

  it("says it is loading rather than claiming the recipe is gone", async () => {
    mockGetRecipe.mockImplementation(() => new Promise(() => {}));

    await render(<RecipeRoute />);

    expect(screen.getByTestId("recipes.detail-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.detail-missing")).toBeNull();
  });

  // The plan can outlive the recipe it points at, so a screen opened from the
  // week strip has to be able to say this without reading as a crash.
  it("says plainly when the recipe is no longer in the library", async () => {
    mockGetRecipe.mockResolvedValue(null);

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.detail-missing")).toHaveTextContent(
      /no longer in your library/,
    );
    expect(screen.queryByTestId("recipes.detail-error")).toBeNull();
  });

  it("offers a retry when the recipe could not be loaded at all", async () => {
    mockGetRecipe.mockRejectedValue(new Error("recipe-service unreachable"));

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.detail-error")).toHaveTextContent(
      /recipe-service unreachable/,
    );
    await fireEvent.press(screen.getByTestId("recipes.detail-retry"));
    await waitFor(() => expect(mockGetRecipe).toHaveBeenCalledTimes(2));
  });
});

describe("the recipe screen — what it shows", () => {
  it("shows the ingredients as lines a cook can read off", async () => {
    mockGetRecipe.mockResolvedValue(
      recipe({
        ingredients: [{ item: "olive oil", quantity: 2, unit: "tbsp", note: "warmed" }],
      }),
    );

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.ingredient.olive-oil")).toHaveTextContent(
      "2 tbsp olive oil, warmed",
    );
  });

  it("names the equipment from the catalog, not by its slug", async () => {
    mockGetRecipe.mockResolvedValue(recipe({ equipment: [{ id: "oven", required: true }] }));

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.equipment-item.oven")).toHaveTextContent("Oven");
  });

  // Windows, not dates: a recipe being read has no cook date, so a date here
  // would be a fiction. Check-off lives on Home, where a task has a dinner.
  it("shows lead-time prep as a window, with where it came from", async () => {
    mockForRecipe.mockResolvedValue(prep([THAW]));

    await render(<RecipeRoute />);

    const task = await screen.findByTestId("recipes.prep-task.thaw-frozen-protein-turkey");
    expect(task).toHaveTextContent(/The night before/);
    expect(task).toHaveTextContent(/auto/);
    expect(task).not.toHaveTextContent(/2026-08-04/);
  });

  it("lists the method in order", async () => {
    await render(<RecipeRoute />);

    await screen.findByTestId("recipes.detail-title");
    expect(screen.getAllByTestId("recipes.step")).toHaveLength(3);
    expect(screen.getByTestId("recipes.steps")).toHaveTextContent(/1Heat the oven\./);
  });
});

describe("the recipe screen — cooking from it", () => {
  it("offers to start cooking, counting the steps", async () => {
    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.start-cooking")).toHaveTextContent(
      "Start cooking · 3 steps",
    );
  });

  it("routes to cooking mode for this recipe", async () => {
    await render(<RecipeRoute />);

    await fireEvent.press(await screen.findByTestId("recipes.start-cooking"));

    expect(mockNavigate).toHaveBeenCalledWith("/recipe/r1/cook");
  });

  // A recipe with no method is a shopping aid; offering to cook from it step by
  // step would land the user on an empty screen.
  it("offers no cooking mode for a recipe with no method", async () => {
    mockGetRecipe.mockResolvedValue(recipe({ steps: [] }));

    await render(<RecipeRoute />);

    await screen.findByTestId("recipes.detail-title");
    expect(screen.queryByTestId("recipes.start-cooking")).toBeNull();
  });

  it("goes back where it came from", async () => {
    await render(<RecipeRoute />);

    await fireEvent.press(screen.getByTestId("recipes.back"));

    expect(mockBack).toHaveBeenCalled();
  });
});

describe("the recipe screen — partial failure", () => {
  // A cooking screen that blanks because the prep rules were slow is worse than
  // one missing a line. Same for the equipment catalog.
  it("still renders the recipe when the prep derivation fails", async () => {
    mockForRecipe.mockRejectedValue(new Error("rules unavailable"));

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.detail-title")).toHaveTextContent("Roast turkey");
    expect(screen.queryByTestId("recipes.detail-error")).toBeNull();
  });

  it("falls back to the slug when the equipment catalog is unreachable", async () => {
    mockGetRecipe.mockResolvedValue(recipe({ equipment: [{ id: "oven", required: true }] }));
    mockListEquipment.mockRejectedValue(new Error("catalog down"));

    await render(<RecipeRoute />);

    expect(await screen.findByTestId("recipes.equipment-item.oven")).toHaveTextContent("oven");
  });
});
