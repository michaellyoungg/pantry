import type { EquipmentDef, EquipmentFit, Recipe } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react-native";

/**
 * The catalog view. `convex/react` is mocked; `useCatalog()` is not — the
 * filtering rules are shared with web and tested there, so what this suite
 * proves is that the phone's controls drive them and that the equipment filter
 * says what it hid.
 *
 * `jest.mock` is hoisted above this file's imports, so the factory may only
 * close over names prefixed `mock`.
 */
const mockListCatalog = jest.fn(async () => [] as unknown);
const mockMakeability = jest.fn(async () => ({ fits: {}, counts: {} }) as unknown);
const mockAddFromCatalog = jest.fn(async () => ({}) as unknown);
const mockListEquipment = jest.fn(async () => [] as unknown);

jest.mock("convex/react", () => {
  const { getFunctionName } = require("convex/server");
  return {
    useQuery: () => ({ householdSize: undefined }),
    useAction: (ref: unknown) => {
      const name = getFunctionName(ref);
      if (name === "equipment:makeability") return mockMakeability;
      if (name === "recipes:addFromCatalog") return mockAddFromCatalog;
      if (name === "recipes:listEquipment") return mockListEquipment;
      return mockListCatalog;
    },
    useMutation: () => {
      const fn = (async () => undefined) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { CatalogBrowser } from "./CatalogBrowser";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "catalog",
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

const fit = (status: EquipmentFit["status"], missing: string[] = []): EquipmentFit => ({
  status,
  missing,
  unlockedBy: [],
});

const SMOKER: EquipmentDef = { id: "smoker", name: "Smoker", category: "appliance", aliases: [] };

const CATALOG = [
  recipe({
    id: "fast",
    title: "Fast Pasta",
    cuisine: "italian",
    tags: ["vegan"],
    totalMinutes: 20,
  }),
  recipe({ id: "slow", title: "Slow Brisket", cuisine: "american", totalMinutes: 300 }),
  recipe({ id: "untimed", title: "Untimed Salad", cuisine: "italian" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockListCatalog.mockResolvedValue(CATALOG);
  mockMakeability.mockResolvedValue({
    fits: { fast: fit("makeable"), slow: fit("blocked", ["smoker"]), untimed: fit("unknown") },
    counts: { makeable: 1, blocked: 1, unknown: 1 },
  });
  mockAddFromCatalog.mockResolvedValue(recipe({ id: "clone-1" }));
  mockListEquipment.mockResolvedValue([SMOKER]);
});

describe("browsing", () => {
  it("lists the catalog with what answers 'tonight?' on each row", async () => {
    await render(<CatalogBrowser />);

    const row = await screen.findByTestId("recipes.catalog-item.fast-pasta");
    expect(row).toHaveTextContent(/20 min/);
    expect(row).toHaveTextContent(/Italian/);
  });

  it("names what a blocked recipe is missing, rather than showing a slug", async () => {
    await render(<CatalogBrowser />);

    expect(await screen.findByTestId("recipes.catalog-item.slow-brisket")).toHaveTextContent(
      /Needs Smoker/,
    );
  });

  it("says the catalog is empty rather than looking broken", async () => {
    mockListCatalog.mockResolvedValue([]);

    await render(<CatalogBrowser />);

    expect(await screen.findByTestId("recipes.catalog-empty")).toBeOnTheScreen();
  });

  it("keeps the catalog readable when the equipment lookup fails", async () => {
    // Three independent requests: losing fits costs the badges and the makeable
    // filter, never the list the user came for.
    mockMakeability.mockRejectedValue(new Error("equipment down"));

    await render(<CatalogBrowser />);

    expect(await screen.findByTestId("recipes.catalog-item.fast-pasta")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.only-makeable")).toBeNull();
    expect(screen.getByTestId("recipes.catalog-no-kitchen")).toBeOnTheScreen();
  });
});

describe("search and chips", () => {
  it("narrows on the search box", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.changeText(await screen.findByTestId("recipes.catalog-search"), "brisket");

    expect(screen.getByTestId("recipes.catalog-item.slow-brisket")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.catalog-item.fast-pasta")).toBeNull();
  });

  it("offers only the chips this catalog can satisfy", async () => {
    await render(<CatalogBrowser />);

    expect(await screen.findByTestId("recipes.catalog-chip.cuisine-italian")).toBeOnTheScreen();
    expect(screen.getByTestId("recipes.catalog-chip.diet-vegan")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.catalog-chip.diet-pescatarian")).toBeNull();
  });

  it("never rounds an unknown cook time into 'fast'", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.catalog-chip.time-30"));

    expect(screen.getByTestId("recipes.catalog-item.fast-pasta")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.catalog-item.untimed-salad")).toBeNull();
  });

  it("clears back to the whole catalog", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.changeText(await screen.findByTestId("recipes.catalog-search"), "nothing");

    expect(screen.getByTestId("recipes.catalog-no-matches")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("recipes.clear-filters"));

    expect(screen.getByTestId("recipes.catalog-item.fast-pasta")).toBeOnTheScreen();
  });
});

describe("the equipment filter", () => {
  it("shows only what this kitchen can make", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.only-makeable"));

    expect(screen.getByTestId("recipes.catalog-item.fast-pasta")).toBeOnTheScreen();
    expect(screen.queryByTestId("recipes.catalog-item.slow-brisket")).toBeNull();
  });

  it("names what it hid, so missing data never looks like a short catalog", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.only-makeable"));

    expect(screen.getByTestId("recipes.catalog-hidden")).toHaveTextContent(
      /missing equipment for and 1 we have no equipment details for/,
    );
  });
});

describe("adding from the catalog", () => {
  it("clones the recipe rather than basketing the shared row", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.catalog-add.fast-pasta"));

    expect(mockAddFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ catalogRecipeId: "fast" }),
    );
  });

  it("says so afterwards rather than going quiet", async () => {
    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.catalog-add.fast-pasta"));

    expect(await screen.findByTestId("recipes.catalog-add.fast-pasta")).toHaveTextContent(/Added/);
  });

  it("surfaces a failed add instead of leaving a tap that did nothing", async () => {
    mockAddFromCatalog.mockRejectedValueOnce(new Error("offline"));

    await render(<CatalogBrowser />);
    await fireEvent.press(await screen.findByTestId("recipes.catalog-add.fast-pasta"));

    expect(await screen.findByTestId("recipes.catalog-add-error")).toHaveTextContent(/offline/);
  });
});
