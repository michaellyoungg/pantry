import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { listEquipment: "recipes.listEquipment" },
    equipment: {
      list: "equipment.list",
      setOwned: "equipment.setOwned",
      unlockedBy: "equipment.unlockedBy",
    },
    basket: { add: "basket.add" },
  },
}));

const { listEquipment, unlockedBy, setOwnedMock, addMock, ownedRows } = vi.hoisted(() => {
  const withOpt = <T,>(fn: T) => {
    (fn as { withOptimisticUpdate: (u: unknown) => T }).withOptimisticUpdate = () => fn;
    return fn as T & { withOptimisticUpdate: (u: unknown) => T };
  };
  return {
    listEquipment: vi.fn(),
    unlockedBy: vi.fn(),
    setOwnedMock: withOpt(vi.fn(() => Promise.resolve())),
    addMock: withOpt(vi.fn(() => Promise.resolve())),
    ownedRows: { current: [] as Array<{ _id: string; equipmentId: string; addedAt: number }> },
  };
});

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ({ "recipes.listEquipment": listEquipment, "equipment.unlockedBy": unlockedBy })[ref],
  useMutation: (ref: string) =>
    ({ "equipment.setOwned": setOwnedMock, "basket.add": addMock })[ref],
  useQuery: () => ownedRows.current,
}));

import { MyKitchen } from "./MyKitchen";

const CATALOG = [
  { id: "oven", name: "Oven", category: "appliance", aliases: [] },
  { id: "panini_press", name: "Panini press", category: "appliance", aliases: [] },
  { id: "whisk", name: "Whisk", category: "tool", aliases: [] },
];

function owns(...ids: string[]) {
  ownedRows.current = ids.map((equipmentId, i) => ({
    _id: `row-${equipmentId}`,
    equipmentId,
    addedAt: i,
  }));
}

describe("MyKitchen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEquipment.mockResolvedValue(CATALOG);
    unlockedBy.mockResolvedValue([]);
    ownedRows.current = [];
  });

  it("groups the catalog into sections", async () => {
    render(<MyKitchen />);
    await screen.findByText("Appliances");
    expect(screen.getByText("Tools")).toBeTruthy();
    // Nothing owned, so no cookware entry is checked — and the empty section
    // isn't rendered at all.
    expect(screen.queryByText("Cookware")).toBeNull();
  });

  it("records what the user ticks", async () => {
    render(<MyKitchen />);
    const box = await screen.findByLabelText("Panini press");
    fireEvent.click(box);

    await waitFor(() =>
      expect(setOwnedMock).toHaveBeenCalledWith({ equipmentId: "panini_press", owned: true }),
    );
  });

  it("un-ticking sends owned:false rather than deleting by row id", async () => {
    owns("oven");
    render(<MyKitchen />);
    fireEvent.click(await screen.findByLabelText("Oven"));

    await waitFor(() =>
      expect(setOwnedMock).toHaveBeenCalledWith({ equipmentId: "oven", owned: false }),
    );
  });

  it("reflects what is already owned", async () => {
    owns("oven");
    render(<MyKitchen />);
    expect((await screen.findByLabelText("Oven")) as HTMLInputElement).toHaveProperty(
      "checked",
      true,
    );
    expect((screen.getByLabelText("Whisk") as HTMLInputElement).checked).toBe(false);
  });

  it("opens the unlocks panel the moment something is ticked", async () => {
    // The payoff arrives in the same breath as the chore.
    unlockedBy.mockResolvedValue([
      {
        id: "r1",
        userId: "u",
        title: "Cubano",
        ingredients: [],
        steps: [],
        equipment: [],
        methods: [],
        createdAt: "",
        status: "makeable",
        missing: [],
        unlockedBy: ["panini_press"],
      },
    ]);
    render(<MyKitchen />);
    fireEvent.click(await screen.findByLabelText("Panini press"));

    await screen.findByText("New with your Panini press");
    expect(await screen.findByText("Cubano")).toBeTruthy();
    expect(unlockedBy).toHaveBeenCalledWith({ equipmentId: "panini_press" });
  });

  it("does not open the unlocks panel when something is un-ticked", async () => {
    owns("oven");
    render(<MyKitchen />);
    fireEvent.click(await screen.findByLabelText("Oven"));

    await waitFor(() => expect(setOwnedMock).toHaveBeenCalled());
    expect(screen.queryByText(/New with your/)).toBeNull();
    expect(unlockedBy).not.toHaveBeenCalled();
  });

  it("lets an owned device be re-asked later", async () => {
    owns("panini_press");
    render(<MyKitchen />);
    fireEvent.click(await screen.findByRole("button", { name: /what can i make with my panini/i }));

    await screen.findByText("New with your Panini press");
  });

  it("says plainly when a device unlocks nothing", async () => {
    // A real, common answer — not an error, and not silence.
    owns("whisk");
    render(<MyKitchen />);
    fireEvent.click(await screen.findByRole("button", { name: /what can i make with my whisk/i }));

    expect(
      await screen.findByText(/Nothing in your recipes or the catalog needs a whisk/i),
    ).toBeTruthy();
  });

  it("reports how much of the catalog is in the kitchen", async () => {
    owns("oven", "whisk");
    render(<MyKitchen />);
    expect(await screen.findByText("2 of 3 in your kitchen.")).toBeTruthy();
  });
});
