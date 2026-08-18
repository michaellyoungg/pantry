import type { EquipmentDef, Recipe } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * The tab shell and "My recipes". `convex/react` is mocked; the shared hooks
 * are not — the screen is presentation over `useMyRecipes()`, so what is worth
 * proving is that real recipes reach it and that its three writes leave through
 * the right actions.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockList = jest.fn(async () => [] as unknown);
const mockRemove = jest.fn(async () => undefined as unknown);
const mockListCatalog = jest.fn(async () => [] as unknown);
const mockMakeability = jest.fn(async () => ({ fits: {}, counts: {} }) as unknown);
const mockListEquipment = jest.fn(async () => [] as unknown);
const mockMutations: Record<string, jest.Mock> = {};
const mockOwned = { rows: [] as unknown[] };
const mockNavigate = jest.fn();

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: (ref: unknown) =>
      getFunctionName(ref).startsWith("equipment:") ? mockOwned.rows : { householdSize: undefined },
    useAction: (ref: unknown) => {
      const name = getFunctionName(ref);
      if (name === "recipes:remove") return mockRemove;
      if (name === "recipes:listCatalog") return mockListCatalog;
      if (name === "recipes:listEquipment") return mockListEquipment;
      if (name === "equipment:makeability") return mockMakeability;
      return mockList;
    },
    useMutation: (ref: unknown) => {
      const name = getFunctionName(ref).replace(":", "-");
      mockMutations[name] ??= jest.fn(async () => undefined);
      const fn = (...args: unknown[]) => mockMutations[name](...args);
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate, back: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Not colocated with the route on purpose — see appRouteTree.test.ts.
import RecipesRoute from "../../app/(tabs)/recipes";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Weeknight Chilli",
    ingredients: [{ item: "beans", quantity: 1, unit: "tin" }],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const OVEN: EquipmentDef = { id: "oven", name: "Oven", category: "appliance", aliases: [] };

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockMutations)) delete mockMutations[key];
  mockOwned.rows = [];
  mockList.mockResolvedValue([recipe()]);
  mockRemove.mockResolvedValue(undefined);
  mockListCatalog.mockResolvedValue([]);
  mockMakeability.mockResolvedValue({ fits: {}, counts: {} });
  mockListEquipment.mockResolvedValue([OVEN]);
});

describe("the three views", () => {
  it("opens on the user's own recipes", async () => {
    await render(<RecipesRoute />);

    expect(await screen.findByTestId("recipes.item.weeknight-chilli")).toBeOnTheScreen();
    expect(screen.getByTestId("recipes.section.mine").props.accessibilityState.selected).toBe(true);
  });

  it("switches in place rather than pushing a screen", async () => {
    // Three peers over one subject, not three destinations: going back to My
    // recipes must not be a back gesture through the catalog.
    await render(<RecipesRoute />);
    await fireEvent.press(screen.getByTestId("recipes.section.catalog"));

    expect(await screen.findByTestId("recipes.catalog-empty")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.item.weeknight-chilli")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reaches the kitchen from the same control", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(screen.getByTestId("recipes.section.kitchen"));

    expect(await screen.findByTestId("recipes.equipment.oven")).toBeOnTheScreen();
  });
});

describe("my recipes", () => {
  it("tells 'still loading' apart from 'you have none'", async () => {
    // A request that never settles: the empty copy is a claim about the
    // account, and making it during the first round trip is wrong.
    mockList.mockReturnValue(new Promise(() => {}));

    await render(<RecipesRoute />);

    expect(screen.getByTestId("recipes.mine-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.mine-empty")).toBeNull();
  });

  it("says how to get a first recipe rather than just that there are none", async () => {
    mockList.mockResolvedValue([]);

    await render(<RecipesRoute />);

    expect(await screen.findByTestId("recipes.mine-empty")).toHaveTextContent(/catalog/i);
  });

  it("flags a duplicate title without blocking it", async () => {
    // Two takes on one dish are legal (BL-0013) — all the list owes the user is
    // the ability to see the collision.
    mockList.mockResolvedValue([
      recipe({ id: "a", title: "Garlic Bread" }),
      recipe({ id: "b", title: "garlic bread " }),
    ]);

    await render(<RecipesRoute />);

    // Both rows answer to the one slugged id, which is exactly the collision.
    expect(await screen.findAllByTestId("recipes.duplicate.garlic-bread")).toHaveLength(2);
  });

  it("opens the recipe screen when the row is tapped", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.open.weeknight-chilli"));

    expect(mockNavigate).toHaveBeenCalledWith("/recipe/r1");
  });

  it("routes Add and Edit to the one review surface", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(screen.getByTestId("recipes.add"));
    expect(mockNavigate).toHaveBeenCalledWith("/recipes/new");

    await fireEvent.press(await screen.findByTestId("recipes.edit.weeknight-chilli"));
    expect(mockNavigate).toHaveBeenCalledWith("/recipe/r1/edit");
  });

  it("baskets a recipe at the household's batch size", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.basket.weeknight-chilli"));

    await waitFor(() =>
      expect(mockMutations["basket-add"]).toHaveBeenCalledWith(
        expect.objectContaining({ recipeId: "r1", title: "Weeknight Chilli" }),
      ),
    );
  });

  it("asks before deleting, rather than firing on a mis-tap", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.remove.weeknight-chilli"));

    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId("recipes.confirm-delete.weeknight-chilli")).toBeOnTheScreen();
  });

  it("deletes once confirmed", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.remove.weeknight-chilli"));
    await fireEvent.press(screen.getByTestId("recipes.confirm-delete.weeknight-chilli"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ id: "r1" }));
  });

  it("backs out on Keep", async () => {
    await render(<RecipesRoute />);
    await fireEvent.press(await screen.findByTestId("recipes.remove.weeknight-chilli"));
    await fireEvent.press(screen.getByTestId("recipes.cancel-delete.weeknight-chilli"));

    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId("recipes.remove.weeknight-chilli")).toBeOnTheScreen();
  });

  it("offers a retry when the list could not be loaded", async () => {
    mockList.mockRejectedValueOnce(new Error("service down"));

    await render(<RecipesRoute />);

    expect(await screen.findByTestId("recipes.mine-error")).toHaveTextContent(/service down/);

    mockList.mockResolvedValue([recipe()]);
    await fireEvent.press(screen.getByTestId("recipes.mine-retry"));

    expect(await screen.findByTestId("recipes.item.weeknight-chilli")).toBeOnTheScreen();
  });
});
