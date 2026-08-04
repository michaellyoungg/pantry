import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: {
      listCatalog: "recipes.listCatalog",
      listEquipment: "recipes.listEquipment",
      addFromCatalog: "recipes.addFromCatalog",
    },
    equipment: { makeability: "equipment.makeability" },
    basket: { add: "basket.add" },
    preferences: { get: "preferences.get" },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/recipes/kitchen">{children}</a>,
}));

const { listCatalog, makeability, listEquipment, addFromCatalog, addMock, household } = vi.hoisted(
  () => {
    const addMock = vi.fn(() => Promise.resolve()) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof addMock;
    };
    addMock.withOptimisticUpdate = () => addMock;
    return {
      listCatalog: vi.fn(),
      makeability: vi.fn(),
      listEquipment: vi.fn(),
      addFromCatalog: vi.fn(),
      addMock,
      household: { prefs: { householdSize: undefined } as { householdSize?: number } },
    };
  },
);

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ({
      "recipes.listCatalog": listCatalog,
      "equipment.makeability": makeability,
      "recipes.listEquipment": listEquipment,
      "recipes.addFromCatalog": addFromCatalog,
    })[ref],
  useMutation: () => addMock,
  useQuery: () => household.prefs,
}));

import { Catalog } from "./Catalog";

const recipe = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: "catalog",
  title,
  ingredients: [],
  steps: [],
  equipment: [],
  methods: [],
  tags: [],
  createdAt: "",
  ...over,
});

const CAT = recipe("cat-garlic-bread", "Garlic Bread");

const noFits = { fits: {}, counts: { makeable: 0, blocked: 0, unknown: 0 } };

/** Every suite needs the equipment lookups stubbed; most want them inert. */
function stubEquipment() {
  makeability.mockResolvedValue(noFits);
  listEquipment.mockResolvedValue([]);
  addFromCatalog.mockResolvedValue(recipe("r-clone", "Garlic Bread", { userId: "user-a" }));
}

describe("Catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubEquipment();
  });

  it("adds a catalog recipe by cloning it, never by basketing the catalog id", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    // The clone action owns both halves (copy + basket) so the two can never
    // disagree; the client must not reach for basket.add on the catalog id,
    // which would put a row owned by the sentinel user on the user's plan.
    await waitFor(() =>
      expect(addFromCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ catalogRecipeId: "cat-garlic-bread" }),
      ),
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("marks a recipe as added so a second click cannot make a second copy", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    const added = await screen.findByRole("button", { name: /added/i });
    expect((added as HTMLButtonElement).disabled).toBe(true);
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
    stubEquipment();
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

  // The equipment filter and the discovery filters answer different questions,
  // so they have to narrow together rather than one overriding the other.
  it("narrows by equipment and cook time together", async () => {
    listCatalog.mockResolvedValue([
      recipe("r-roast", "Roast", { totalMinutes: 15 }),
      recipe("r-brisket", "Brisket", { totalMinutes: 15 }),
    ]);
    render(<Catalog />);
    await screen.findByText("Roast");

    fireEvent.click(screen.getByRole("button", { name: /under 30 min/i }));
    expect(screen.getByText("Brisket")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/only show recipes i can make/i));
    expect(screen.queryByText("Brisket")).toBeNull();
    expect(screen.getByText("Roast")).toBeTruthy();
  });
});

describe("Catalog seeds the servings dial from household size (BL-0018)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubEquipment();
    household.prefs = { householdSize: undefined };
  });

  // The multiplier now rides on the clone action, but it is still derived from
  // the CATALOG recipe's yield — the clone inherits it, so both agree.
  it("halves a catalog recipe that feeds twice the household", async () => {
    household.prefs = { householdSize: 2 };
    listCatalog.mockResolvedValue([recipe(CAT.id, CAT.title, { servings: 4 })]);

    render(<Catalog />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(addFromCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ catalogRecipeId: CAT.id, servingsMultiplier: 0.5 }),
      ),
    );
  });

  it("sends no multiplier when there is nothing to derive one from", async () => {
    listCatalog.mockResolvedValue([CAT]);

    render(<Catalog />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(addFromCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ servingsMultiplier: undefined }),
      ),
    );
  });
});

describe("Catalog search", () => {
  const TWO = [
    recipe("cat-a", "Garlic Bread", { tags: ["vegetarian"] }),
    recipe("cat-b", "Pancakes", {
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
      tags: ["breakfast"],
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    stubEquipment();
    listCatalog.mockResolvedValue(TWO);
  });

  it("filters by title as the query changes", async () => {
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "pan" } });
    expect(screen.queryByText("Garlic Bread")).toBeNull();
    expect(screen.getByText("Pancakes")).toBeTruthy();
  });

  it("matches on ingredient names", async () => {
    render(<Catalog />);
    await screen.findByText("Pancakes");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "flour" } });
    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });

  // Tags are an open vocabulary, so most of them never get a chip. Search is
  // what keeps them useful rather than write-only.
  it("matches on tags that have no filter chip", async () => {
    render(<Catalog />);
    await screen.findByText("Pancakes");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "breakfast" } });
    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });

  it("shows a no-match message with a way back", async () => {
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "zzz" } });
    await screen.findByText(/no recipes match/i);
    expect(screen.queryByText("Garlic Bread")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Garlic Bread")).toBeTruthy();
  });
});

describe("Catalog filter chips", () => {
  const RECIPES = [
    recipe("cat-quick", "Quick Salad", {
      totalMinutes: 10,
      cuisine: "american",
      tags: ["vegan", "vegetarian"],
    }),
    recipe("cat-slow", "Slow Roast", {
      totalMinutes: 180,
      cuisine: "italian",
      tags: ["gluten-free"],
    }),
    // No cook time at all — the case the filter must not guess about.
    recipe("cat-unknown", "Mystery Stew", { tags: ["vegetarian"] }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    stubEquipment();
    listCatalog.mockResolvedValue(RECIPES);
  });

  it("filters by cook time", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /under 15 min/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.queryByText("Slow Roast")).toBeNull();
  });

  // The important negative: "unknown" is not "fast".
  it("excludes recipes with no stated cook time from every time bucket", async () => {
    render(<Catalog />);
    await screen.findByText("Mystery Stew");

    fireEvent.click(screen.getByRole("button", { name: /under 1 hour/i }));
    expect(screen.queryByText("Mystery Stew")).toBeNull();
    expect(screen.getByText("Quick Salad")).toBeTruthy();
  });

  it("toggles a time chip back off", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    const chip = screen.getByRole("button", { name: /under 15 min/i });
    fireEvent.click(chip);
    expect(screen.queryByText("Slow Roast")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("Slow Roast")).toBeTruthy();
  });

  it("filters by diet", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    fireEvent.click(screen.getByRole("button", { name: /^vegan$/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.queryByText("Slow Roast")).toBeNull();
    expect(screen.queryByText("Mystery Stew")).toBeNull();
  });

  it("ORs multiple diet chips together", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    fireEvent.click(screen.getByRole("button", { name: /^vegan$/i }));
    fireEvent.click(screen.getByRole("button", { name: /gluten free/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.getByText("Slow Roast")).toBeTruthy();
    expect(screen.queryByText("Mystery Stew")).toBeNull();
  });

  it("filters by cuisine", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /italian/i }));
    expect(screen.getByText("Slow Roast")).toBeTruthy();
    expect(screen.queryByText("Quick Salad")).toBeNull();
  });

  it("ANDs different filter groups together", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /under 15 min/i }));
    fireEvent.click(screen.getByRole("button", { name: /gluten free/i }));
    // Nothing is both under 15 minutes AND gluten free.
    await screen.findByText(/no recipes match/i);
  });

  // Chips are built from the loaded data, so we never offer one that matches
  // nothing — and a cuisine nobody in the catalog uses gets no chip at all.
  it("only offers chips the catalog can satisfy", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    expect(screen.queryByRole("button", { name: /^thai$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pescatarian/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^vegan$/i })).toBeTruthy();
  });
});
