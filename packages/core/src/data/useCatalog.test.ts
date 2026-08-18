// @vitest-environment jsdom
import type { EquipmentDef, EquipmentFit, Recipe } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listCatalog: vi.fn(async () => [] as unknown),
  makeability: vi.fn(async () => ({}) as unknown),
  addFromCatalog: vi.fn(async () => ({}) as unknown),
  listEquipment: vi.fn(async () => [] as unknown),
  householdSize: undefined as number | undefined,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => ({ householdSize: state.householdSize }),
    useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "equipment:makeability") return state.makeability;
      if (name === "recipes:addFromCatalog") return state.addFromCatalog;
      if (name === "recipes:listEquipment") return state.listEquipment;
      return state.listCatalog;
    },
  };
});

const { useCatalog } = await import("./useCatalog");

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "catalog",
    title: "Weeknight chilli",
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
    title: "Fast pasta",
    cuisine: "italian",
    tags: ["vegan"],
    totalMinutes: 20,
  }),
  recipe({ id: "slow", title: "Slow brisket", cuisine: "american", totalMinutes: 300 }),
  recipe({ id: "untimed", title: "Untimed salad", cuisine: "italian" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  state.householdSize = undefined;
  state.listCatalog.mockResolvedValue(CATALOG);
  state.makeability.mockResolvedValue({
    fits: { fast: fit("makeable"), slow: fit("blocked", ["smoker"]), untimed: fit("unknown") },
    counts: { makeable: 1, blocked: 1, unknown: 1 },
  });
  state.addFromCatalog.mockResolvedValue(recipe({ id: "clone-1" }));
  state.listEquipment.mockResolvedValue([SMOKER]);
});

afterEach(cleanup);

async function mounted() {
  const view = renderHook(() => useCatalog());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await waitFor(() => expect(view.result.current.canFilter).toBe(true));
  return view;
}

describe("loading", () => {
  it("tells 'still loading' apart from 'the catalog is empty'", async () => {
    const { result } = renderHook(() => useCatalog());

    expect(result.current.loading).toBe(true);
    expect(result.current.recipes).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("keeps the catalog readable when the equipment lookup fails", async () => {
    // Three independent requests: losing fits costs the badges and the
    // makeable filter, never the list the user came for.
    state.makeability.mockRejectedValue(new Error("equipment down"));

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.shown).toHaveLength(3));
    expect(result.current.canFilter).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it("does not offer the makeable filter when nothing has been classified", async () => {
    state.makeability.mockResolvedValue({
      fits: {},
      counts: { makeable: 0, blocked: 0, unknown: 0 },
    });

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canFilter).toBe(false);
  });
});

describe("search and chips", () => {
  it("narrows on the search box", async () => {
    const { result } = await mounted();
    act(() => result.current.setQuery("brisket"));

    expect(result.current.shown.map((r) => r.id)).toEqual(["slow"]);
    expect(result.current.filterActive).toBe(true);
  });

  it("toggles a cook-time bucket off when it is tapped twice", async () => {
    const { result } = await mounted();

    act(() => result.current.toggleCookTime("30"));
    expect(result.current.shown.map((r) => r.id)).toEqual(["fast"]);

    act(() => result.current.toggleCookTime("30"));
    expect(result.current.shown).toHaveLength(3);
  });

  it("offers only the chips the loaded catalog can satisfy", async () => {
    const { result } = await mounted();

    expect(result.current.cuisines).toEqual(["american", "italian"]);
    expect(result.current.diets).toEqual(["vegan"]);
  });

  it("ANDs a diet with a cuisine", async () => {
    const { result } = await mounted();

    act(() => result.current.toggleDiet("vegan"));
    act(() => result.current.toggleCuisine("italian"));

    expect(result.current.shown.map((r) => r.id)).toEqual(["fast"]);
  });

  it("clears back to the whole catalog", async () => {
    const { result } = await mounted();

    act(() => result.current.setQuery("brisket"));
    act(() => result.current.clearFilter());

    expect(result.current.shown).toHaveLength(3);
    expect(result.current.filterActive).toBe(false);
  });
});

describe("the equipment filter", () => {
  it("shows only what this kitchen can make", async () => {
    const { result } = await mounted();
    act(() => result.current.setOnlyMakeable(true));

    expect(result.current.shown.map((r) => r.id)).toEqual(["fast"]);
  });

  it("names what it hid, separating 'missing equipment' from 'we don't know'", async () => {
    const { result } = await mounted();
    act(() => result.current.setOnlyMakeable(true));

    expect(result.current.hidden).toBe(
      "Hiding 1 you're missing equipment for and 1 we have no equipment details for.",
    );
  });

  it("narrows alongside the chips rather than replacing them", async () => {
    const { result } = await mounted();

    act(() => result.current.setOnlyMakeable(true));
    act(() => result.current.toggleCuisine("american"));

    // "american" alone would show the brisket; it is blocked, so nothing is left.
    expect(result.current.shown).toEqual([]);
  });
});

describe("adding a catalog recipe", () => {
  it("clones it at the household's batch size", async () => {
    state.householdSize = 4;
    state.listCatalog.mockResolvedValue([recipe({ id: "fast", servings: 2 })]);

    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.recipes).toHaveLength(1));
    await act(() => result.current.add(result.current.recipes[0]));

    expect(state.addFromCatalog).toHaveBeenCalledWith({
      catalogRecipeId: "fast",
      servingsMultiplier: 2,
    });
    expect(result.current.added).toEqual(["fast"]);
  });

  it("does not mark it added when the clone failed", async () => {
    state.addFromCatalog.mockRejectedValueOnce(new Error("offline"));

    const { result } = await mounted();
    await act(() => result.current.add(result.current.recipes[0]));

    expect(result.current.added).toEqual([]);
    expect(result.current.error).toBe("offline");
  });

  it("records an id once, however many times it is added", async () => {
    const { result } = await mounted();
    await act(() => result.current.add(result.current.recipes[0]));
    await act(() => result.current.add(result.current.recipes[0]));

    expect(result.current.added).toEqual(["fast"]);
  });
});
