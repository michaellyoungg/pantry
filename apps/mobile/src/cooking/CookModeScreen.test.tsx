import type { Recipe } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react-native";

/**
 * Cooking mode, driven through its route module.
 *
 * `convex/react` is mocked; `useRecipeDetail()` is not, so the recipe reaches
 * this screen exactly as it reaches the detail screen — the two must never
 * disagree about the same recipe.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockGetRecipe = jest.fn(async () => null as unknown);
const mockForRecipe = jest.fn(async () => null as unknown);
const mockBack = jest.fn();
const mockKeepAwake = jest.fn();

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useAction: (ref: never) =>
      getFunctionName(ref) === "recipes:get" ? mockGetRecipe : mockForRecipe,
  };
});

// The real module talks to a native activation API that does not exist in a
// Node test process; what this screen owes the user is that it ASKS.
jest.mock("expo-keep-awake", () => ({ useKeepAwake: () => mockKeepAwake() }));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "r1" }),
  useRouter: () => ({ navigate: jest.fn(), back: mockBack }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import CookRoute from "../../app/recipe/[id]/cook";
// See `src/testing/appRouteTree.test.ts` for why this test does not live next
// to the route it renders.
import { STEP_CONTROL_HEIGHT, STEP_FONT_SIZE } from "./legibility";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Roast turkey",
    ingredients: [],
    steps: ["Heat the oven to 180°C.", "Roast for an hour.", "Rest it for twenty minutes."],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRecipe.mockResolvedValue(recipe());
  mockForRecipe.mockResolvedValue(null);
});

describe("cooking mode", () => {
  it("starts on the first step and says where you are", async () => {
    await render(<CookRoute />);

    expect(await screen.findByTestId("recipes.cook-step")).toHaveTextContent(
      "Heat the oven to 180°C.",
    );
    expect(screen.getByTestId("recipes.cook-progress")).toHaveTextContent("Step 1 of 3");
  });

  // The phone is propped against a bowl at arm's length, so the step is drawn
  // outside the token scale on purpose (see `legibility.ts`).
  it("draws the step large enough to read from across a worktop", async () => {
    await render(<CookRoute />);

    const step = await screen.findByTestId("recipes.cook-step");
    expect(step.props.style).toMatchObject({ fontSize: STEP_FONT_SIZE });
    expect(STEP_FONT_SIZE).toBeGreaterThan(24);
  });

  it("gives the controls targets a knuckle can hit", async () => {
    await render(<CookRoute />);

    const next = await screen.findByTestId("recipes.cook-next");
    expect(next.props.style).toMatchObject({ minHeight: STEP_CONTROL_HEIGHT });
    expect(STEP_CONTROL_HEIGHT).toBeGreaterThanOrEqual(44);
  });

  // A phone that locks mid-recipe has to be woken with hands that are covered
  // in whatever you are cooking.
  it("holds the screen awake for as long as you are cooking", async () => {
    await render(<CookRoute />);

    expect(mockKeepAwake).toHaveBeenCalled();
  });

  it("walks forwards and backwards through the method", async () => {
    await render(<CookRoute />);
    await screen.findByTestId("recipes.cook-step");

    await fireEvent.press(screen.getByTestId("recipes.cook-next"));
    expect(screen.getByTestId("recipes.cook-step")).toHaveTextContent("Roast for an hour.");
    expect(screen.getByTestId("recipes.cook-progress")).toHaveTextContent("Step 2 of 3");

    await fireEvent.press(screen.getByTestId("recipes.cook-previous"));
    expect(screen.getByTestId("recipes.cook-progress")).toHaveTextContent("Step 1 of 3");
  });

  it("cannot go back off the start of the recipe", async () => {
    await render(<CookRoute />);

    const previous = await screen.findByTestId("recipes.cook-previous");
    expect(previous.props.accessibilityState).toMatchObject({ disabled: true });
  });

  // Never a dead end: the last step offers finishing rather than a greyed-out
  // arrow, and finishing lands back on the recipe it started from.
  it("finishes on the last step instead of stopping dead", async () => {
    await render(<CookRoute />);
    await screen.findByTestId("recipes.cook-step");

    await fireEvent.press(screen.getByTestId("recipes.cook-next"));
    await fireEvent.press(screen.getByTestId("recipes.cook-next"));

    expect(screen.getByTestId("recipes.cook-progress")).toHaveTextContent("Step 3 of 3");
    expect(screen.queryByTestId("recipes.cook-next")).toBeNull();
    await fireEvent.press(screen.getByTestId("recipes.cook-finish"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("leaves when told to, mid-recipe", async () => {
    await render(<CookRoute />);

    await fireEvent.press(screen.getByTestId("recipes.cook-close"));

    expect(mockBack).toHaveBeenCalled();
  });

  // A recipe with no method is a shopping aid. Two arrows over an empty screen
  // would be worse than saying so.
  it("says when there is no method to cook from", async () => {
    mockGetRecipe.mockResolvedValue(recipe({ steps: [] }));

    await render(<CookRoute />);

    expect(await screen.findByTestId("recipes.cook-no-steps")).toHaveTextContent(
      /no method written down/,
    );
    expect(screen.queryByTestId("recipes.cook-next")).toBeNull();
  });

  it("says when the recipe is gone rather than showing an empty method", async () => {
    mockGetRecipe.mockResolvedValue(null);

    await render(<CookRoute />);

    expect(await screen.findByTestId("recipes.cook-missing")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.cook-no-steps")).toBeNull();
  });
});
