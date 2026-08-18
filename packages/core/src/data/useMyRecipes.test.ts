// @vitest-environment jsdom
import type { Recipe } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Three actions and three basket mutations, so the mocks have to tell each
// other apart. anyApi references are fresh proxies on every access, so identity
// comparison would silently always pick one branch; the function NAME is stable.
const state = vi.hoisted(() => ({
  listRecipes: vi.fn(async () => [] as unknown),
  removeRecipe: vi.fn(async () => undefined as unknown),
  updateRecipe: vi.fn(async () => undefined as unknown),
  basketAdd: vi.fn(async () => undefined as unknown),
  basketRemove: vi.fn(async () => undefined as unknown),
  basketUpdateTitle: vi.fn(async () => undefined as unknown),
  householdSize: undefined as number | undefined,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  const mutation = (spy: (...a: unknown[]) => Promise<unknown>) => {
    const fn = ((...args: unknown[]) => spy(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  };
  return {
    useQuery: () => ({ householdSize: state.householdSize }),
    useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "recipes:remove") return state.removeRecipe;
      if (name === "recipes:update") return state.updateRecipe;
      return state.listRecipes;
    },
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "basket:remove") return mutation(state.basketRemove);
      if (name === "basket:updateTitle") return mutation(state.basketUpdateTitle);
      return mutation(state.basketAdd);
    },
  };
});

const { useMyRecipes } = await import("./useMyRecipes");

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Chilli",
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

const EDIT = {
  title: "Chilli con carne",
  servings: 4,
  ingredients: [],
  steps: [],
  equipment: [],
  methods: [],
  cuisine: "",
  totalMinutes: undefined,
  tags: [],
  sourceUrl: undefined,
  prepTasks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.householdSize = undefined;
  state.listRecipes.mockResolvedValue([recipe()]);
  state.removeRecipe.mockResolvedValue(undefined);
  state.updateRecipe.mockResolvedValue(undefined);
  state.basketAdd.mockResolvedValue(undefined);
  state.basketRemove.mockResolvedValue(undefined);
  state.basketUpdateTitle.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function mounted() {
  const view = renderHook(() => useMyRecipes());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("loading the collection", () => {
  it("tells 'still loading' apart from 'you have no recipes'", async () => {
    const { result } = renderHook(() => useMyRecipes());

    expect(result.current.loading).toBe(true);
    expect(result.current.recipes).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("reports a failed load separately from a failed write", async () => {
    state.listRecipes.mockRejectedValueOnce(new Error("service down"));

    const { result } = renderHook(() => useMyRecipes());

    await waitFor(() => expect(result.current.loadError).toBe("service down"));
    expect(result.current.error).toBeNull();
  });
});

describe("duplicate titles", () => {
  it("flags a collision rather than blocking the write", async () => {
    state.listRecipes.mockResolvedValue([
      recipe({ id: "a", title: "Garlic Bread" }),
      recipe({ id: "b", title: "garlic bread " }),
    ]);

    const { result } = await mounted();

    // Normalized on trim + case: two takes on one dish are legal (BL-0013),
    // and all the collection owes the user is the ability to see them.
    expect(result.current.isDuplicate(recipe({ title: "Garlic Bread" }))).toBe(true);
    expect(result.current.duplicateTitles).toEqual(new Set(["garlic bread"]));
  });

  it("leaves a unique title unflagged", async () => {
    state.listRecipes.mockResolvedValue([recipe({ id: "a" }), recipe({ id: "b", title: "Soup" })]);

    const { result } = await mounted();

    expect(result.current.isDuplicate(recipe({ title: "Soup" }))).toBe(false);
  });
});

describe("adding to the basket", () => {
  it("seeds the batch size from the household default", async () => {
    state.householdSize = 4;
    state.listRecipes.mockResolvedValue([recipe({ servings: 2 })]);

    const { result } = await mounted();
    act(() => result.current.addToBasket(result.current.recipes[0]));

    await waitFor(() =>
      expect(state.basketAdd).toHaveBeenCalledWith({
        recipeId: "r1",
        title: "Chilli",
        servingsMultiplier: 2,
      }),
    );
  });

  it("surfaces a failed add rather than leaving a tap that did nothing", async () => {
    state.basketAdd.mockRejectedValueOnce(new Error("offline"));

    const { result } = await mounted();
    act(() => result.current.addToBasket(result.current.recipes[0]));

    await waitFor(() => expect(result.current.error).toBe("offline"));
  });
});

describe("deleting a recipe", () => {
  it("deletes, then reconciles the basket, then reloads", async () => {
    const { result } = await mounted();
    await act(() => result.current.remove(recipe()));

    expect(state.removeRecipe).toHaveBeenCalledWith({ id: "r1" });
    expect(state.basketRemove).toHaveBeenCalledWith({ recipeId: "r1" });
    await waitFor(() => expect(state.listRecipes).toHaveBeenCalledTimes(2));
  });

  it("never touches the basket when the delete itself failed", async () => {
    state.removeRecipe.mockRejectedValueOnce(new Error("nope"));

    const { result } = await mounted();
    await act(() => result.current.remove(recipe()));

    expect(state.basketRemove).not.toHaveBeenCalled();
    expect(result.current.error).toBe("nope");
  });

  it("keeps the delete and reports the basket as a note when only that fails", async () => {
    // The recipe-service op is the source of truth; a basket failure afterwards
    // must never roll the UI back into claiming the recipe still exists.
    state.basketRemove.mockRejectedValueOnce(new Error("offline"));

    const { result } = await mounted();
    await act(() => result.current.remove(recipe()));

    await waitFor(() => expect(result.current.error).toMatch(/couldn't update the basket/i));
    expect(state.listRecipes).toHaveBeenCalledTimes(2);
  });
});

describe("saving an edit", () => {
  it("sends the whole recipe, because update replaces it", async () => {
    const { result } = await mounted();
    await act(async () => {
      expect(await result.current.save("r1", EDIT)).toBe(true);
    });

    expect(state.updateRecipe).toHaveBeenCalledWith({ id: "r1", ...EDIT });
    expect(state.basketUpdateTitle).toHaveBeenCalledWith({
      recipeId: "r1",
      title: "Chilli con carne",
    });
  });

  it("reports a failed save and does not claim success", async () => {
    state.updateRecipe.mockRejectedValueOnce(new Error("400"));

    const { result } = await mounted();
    await act(async () => {
      expect(await result.current.save("r1", EDIT)).toBe(false);
    });

    expect(state.basketUpdateTitle).not.toHaveBeenCalled();
    expect(result.current.error).toBe("400");
  });

  it("keeps the save when only the basket title write fails", async () => {
    state.basketUpdateTitle.mockRejectedValueOnce(new Error("offline"));

    const { result } = await mounted();
    await act(async () => {
      expect(await result.current.save("r1", EDIT)).toBe(true);
    });

    await waitFor(() => expect(result.current.error).toMatch(/basket title/i));
  });
});
