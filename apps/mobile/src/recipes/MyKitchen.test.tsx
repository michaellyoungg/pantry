import type { EquipmentDef, EquipmentMatch } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react-native";

/**
 * The equipment inventory and the payoff it opens.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockListEquipment = jest.fn(async () => [] as unknown);
const mockUnlockedBy = jest.fn(async () => [] as unknown);
const mockSetOwned = jest.fn(async () => undefined as unknown);
const mockBasketAdd = jest.fn(async () => undefined as unknown);
const mockOwned = { rows: [] as Array<{ equipmentId: string }> | undefined };

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  const mutation = (spy: (...a: unknown[]) => Promise<unknown>) => {
    const fn = ((...args: unknown[]) => spy(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  };
  return {
    useQuery: () => mockOwned.rows,
    useAction: (ref: unknown) =>
      getFunctionName(ref) === "equipment:unlockedBy" ? mockUnlockedBy : mockListEquipment,
    useMutation: (ref: unknown) =>
      getFunctionName(ref) === "equipment:setOwned"
        ? mutation(mockSetOwned)
        : mutation(mockBasketAdd),
  };
});

import { MyKitchen } from "./MyKitchen";

const def = (id: string, name: string, category: EquipmentDef["category"]): EquipmentDef => ({
  id,
  name,
  category,
  aliases: [],
});

const CATALOG = [def("smoker", "Smoker", "appliance"), def("whisk", "Whisk", "tool")];

function match(over: Partial<EquipmentMatch> = {}): EquipmentMatch {
  return {
    id: "r1",
    userId: "catalog",
    title: "Smoked Brisket",
    ingredients: [],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    status: "makeable",
    missing: [],
    unlockedBy: ["smoker"],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOwned.rows = [];
  mockListEquipment.mockResolvedValue(CATALOG);
  mockUnlockedBy.mockResolvedValue([match()]);
  mockSetOwned.mockResolvedValue(undefined);
  mockBasketAdd.mockResolvedValue(undefined);
});

describe("the inventory", () => {
  it("sections the catalog, appliances first", async () => {
    await render(<MyKitchen />);

    expect(await screen.findByTestId("recipes.equipment.smoker")).toBeOnTheScreen();
    expect(screen.getByTestId("recipes.equipment.whisk")).toBeOnTheScreen();
  });

  it("waits for the inventory before claiming the kitchen is empty", async () => {
    mockOwned.rows = undefined;

    await render(<MyKitchen />);

    await screen.findByTestId("recipes.equipment.smoker");
    expect(screen.queryByTestId("recipes.kitchen-count")).toBeNull();
  });

  it("counts what is ticked once the inventory has answered", async () => {
    mockOwned.rows = [{ equipmentId: "smoker" }];

    await render(<MyKitchen />);

    expect(await screen.findByTestId("recipes.kitchen-count")).toHaveTextContent(/1 of 2/);
  });

  it("writes the new state when a device is ticked", async () => {
    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.equipment.smoker"));

    expect(mockSetOwned).toHaveBeenCalledWith({ equipmentId: "smoker", owned: true });
  });
});

describe("what a new device unlocks", () => {
  it("opens in the same breath as ticking the box", async () => {
    // Telling the app what you own is a chore; the payoff has to arrive here
    // rather than on some other screen the user has to go find.
    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.equipment.smoker"));

    expect(await screen.findByTestId("recipes.unlocked.smoked-brisket")).toBeOnTheScreen();
    expect(mockUnlockedBy).toHaveBeenCalledWith({ equipmentId: "smoker" });
  });

  it("words an empty answer as an ordinary result, not a failure", async () => {
    mockUnlockedBy.mockResolvedValue([]);

    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.equipment.smoker"));

    expect(await screen.findByTestId("recipes.unlocks-empty")).toHaveTextContent(
      /when something does/i,
    );
  });

  it("baskets an unlocked recipe", async () => {
    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.equipment.smoker"));
    await fireEvent.press(await screen.findByTestId("recipes.unlocked-add.smoked-brisket"));

    expect(mockBasketAdd).toHaveBeenCalledWith({ recipeId: "r1", title: "Smoked Brisket" });
  });

  it("can be dismissed and re-opened from the row", async () => {
    // Already owned, so the per-row button is the way back in — the discovery
    // moment has passed but the answer is still worth revisiting.
    mockOwned.rows = [{ equipmentId: "smoker" }];

    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.unlocks.smoker"));
    await fireEvent.press(await screen.findByTestId("recipes.unlocks-dismiss"));

    expect(screen.queryByTestId("recipes.unlocks-panel")).toBeNull();

    await fireEvent.press(screen.getByTestId("recipes.unlocks.smoker"));
    expect(await screen.findByTestId("recipes.unlocks-panel")).toBeOnTheScreen();
  });

  it("closes when the device is un-ticked", async () => {
    mockOwned.rows = [{ equipmentId: "smoker" }];

    await render(<MyKitchen />);
    await fireEvent.press(screen.getByTestId("recipes.unlocks.smoker"));
    expect(await screen.findByTestId("recipes.unlocks-panel")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("recipes.equipment.smoker"));
    expect(screen.queryByTestId("recipes.unlocks-panel")).toBeNull();
  });
});

describe("when something fails", () => {
  it("says so rather than leaving a tap that silently did nothing", async () => {
    mockSetOwned.mockRejectedValueOnce(new Error("offline"));

    await render(<MyKitchen />);
    await fireEvent.press(await screen.findByTestId("recipes.equipment.smoker"));

    expect(await screen.findByTestId("recipes.kitchen-write-error")).toHaveTextContent(/offline/);
  });

  it("keeps the checkbox list usable when the catalog request fails", async () => {
    mockListEquipment.mockRejectedValueOnce(new Error("service down"));

    await render(<MyKitchen />);

    expect(await screen.findByTestId("recipes.kitchen-error")).toHaveTextContent(/service down/);
  });
});
