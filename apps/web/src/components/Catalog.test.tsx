import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { listCatalog: "recipes.listCatalog", listEquipment: "recipes.listEquipment" },
    equipment: { makeability: "equipment.makeability" },
    basket: { add: "basket.add" },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/recipes/kitchen">{children}</a>,
}));

const { listCatalog, makeability, listEquipment, addMock } = vi.hoisted(() => {
  const addMock = vi.fn(() => Promise.resolve()) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: (u: unknown) => typeof addMock;
  };
  addMock.withOptimisticUpdate = () => addMock;
  return {
    listCatalog: vi.fn(),
    makeability: vi.fn(),
    listEquipment: vi.fn(),
    addMock,
  };
});

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ({
      "recipes.listCatalog": listCatalog,
      "equipment.makeability": makeability,
      "recipes.listEquipment": listEquipment,
    })[ref],
  useMutation: () => addMock,
}));

import { Catalog } from "./Catalog";

const recipe = (id: string, title: string) => ({
  id,
  userId: "catalog",
  title,
  ingredients: [],
  steps: [],
  equipment: [],
  methods: [],
  createdAt: "",
});

const CAT = recipe("cat-garlic-bread", "Garlic Bread");

const noFits = { fits: {}, counts: { makeable: 0, blocked: 0, unknown: 0 } };

describe("Catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeability.mockResolvedValue(noFits);
    listEquipment.mockResolvedValue([]);
  });

  it("renders catalog recipes and adds one to the basket by reference", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith({ recipeId: "cat-garlic-bread", title: "Garlic Bread" }),
    );
  });

  it("shows an empty state when the catalog is empty", async () => {
    listCatalog.mockResolvedValue([]);
    render(<Catalog />);
    await screen.findByText(/no catalog recipes/i);
  });

  it("shows a loading state before the fetch resolves (not the empty state)", () => {
    listCatalog.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Catalog />);
    expect(screen.getByText(/loading catalog/i)).toBeTruthy();
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
  });

  it("shows an error with retry (not the empty state) when the fetch fails", async () => {
    listCatalog.mockRejectedValueOnce(new Error("backend down")).mockResolvedValue([CAT]);
    render(<Catalog />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/backend down/i);
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Garlic Bread");
  });
});

describe("Catalog equipment fit", () => {
  const ROAST = recipe("r-roast", "Roast");
  const BRISKET = recipe("r-brisket", "Brisket");
  const MYSTERY = recipe("r-mystery", "Mystery Stew");

  const fits = {
    fits: {
      "r-roast": { status: "makeable", missing: [], unlockedBy: [] },
      "r-brisket": { status: "blocked", missing: ["smoker"], unlockedBy: [] },
      "r-mystery": { status: "unknown", missing: [], unlockedBy: [] },
    },
    counts: { makeable: 1, blocked: 1, unknown: 1 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listCatalog.mockResolvedValue([ROAST, BRISKET, MYSTERY]);
    makeability.mockResolvedValue(fits);
    listEquipment.mockResolvedValue([
      { id: "smoker", name: "Smoker", category: "appliance", aliases: [] },
    ]);
  });

  it("badges each recipe, and never calls an unassessed one makeable", async () => {
    render(<Catalog />);
    await screen.findByText("You can make this");
    expect(screen.getByText("Missing equipment")).toBeTruthy();
    // The honesty rule: no equipment was ever recorded, so we say so.
    expect(screen.getByText("Equipment unknown")).toBeTruthy();
    expect(screen.getAllByText("You can make this")).toHaveLength(1);
  });

  it("names the missing equipment rather than showing a slug", async () => {
    render(<Catalog />);
    expect(await screen.findByText(/Needs Smoker/)).toBeTruthy();
  });

  it("filters to what the user can make, and says what it hid", async () => {
    render(<Catalog />);
    await screen.findByText("Roast");
    fireEvent.click(screen.getByLabelText(/only show recipes i can make/i));

    expect(screen.queryByText("Brisket")).toBeNull();
    expect(screen.queryByText("Mystery Stew")).toBeNull();
    expect(screen.getByText("Roast")).toBeTruthy();
    // Blocked and unknown are counted separately: different problems.
    expect(
      screen.getByText(
        /Hiding 1 you're missing equipment for and 1 we have no equipment details for\./,
      ),
    ).toBeTruthy();
  });

  it("offers no filter until the app knows something, and points at My Kitchen", async () => {
    makeability.mockResolvedValue(noFits);
    render(<Catalog />);
    await screen.findByText("Roast");
    expect(screen.queryByLabelText(/only show recipes i can make/i)).toBeNull();
    expect(screen.getByText(/your kitchen/i)).toBeTruthy();
  });

  it("still lists the catalog when the fit lookup fails", async () => {
    // Equipment is an enhancement; losing it must not cost the user the catalog.
    makeability.mockRejectedValue(new Error("equipment service down"));
    render(<Catalog />);
    await screen.findByText("Roast");
    expect(screen.getByText("Brisket")).toBeTruthy();
    expect(screen.queryByLabelText(/only show recipes i can make/i)).toBeNull();
  });
});
