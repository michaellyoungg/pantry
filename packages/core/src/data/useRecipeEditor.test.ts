// @vitest-environment jsdom
import type { PrepMeal, Recipe } from "@pantry/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createRecipe: vi.fn(async () => ({}) as unknown),
  importFromUrl: vi.fn(async () => ({}) as unknown),
  updateRecipe: vi.fn(async () => undefined as unknown),
  getRecipe: vi.fn(async () => null as unknown),
  forRecipe: vi.fn(async () => null as unknown),
  listEquipment: vi.fn(async () => [] as unknown),
  basketUpdateTitle: vi.fn(async () => undefined as unknown),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "recipes:create") return state.createRecipe;
      if (name === "recipes:importFromUrl") return state.importFromUrl;
      if (name === "recipes:update") return state.updateRecipe;
      if (name === "recipes:get") return state.getRecipe;
      if (name === "recipes:listEquipment") return state.listEquipment;
      return state.forRecipe;
    },
    useMutation: () => state.basketUpdateTitle,
  };
});

const { useRecipeEditor } = await import("./useRecipeEditor");

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "u1",
    title: "Chilli",
    servings: 4,
    ingredients: [{ item: "beans", quantity: 1, unit: "tin" }],
    steps: ["Simmer."],
    equipment: [],
    methods: [],
    cuisine: "mexican",
    totalMinutes: 45,
    tags: ["weeknight"],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function prep(tasks: PrepMeal["tasks"]): PrepMeal {
  return { recipeId: "r1", title: "Chilli", cookDate: "2026-08-05", tasks };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.createRecipe.mockResolvedValue(recipe({ id: "new-1" }));
  state.importFromUrl.mockResolvedValue(recipe({ id: "preview" }));
  state.updateRecipe.mockResolvedValue(undefined);
  state.getRecipe.mockResolvedValue(recipe());
  state.forRecipe.mockResolvedValue(prep([]));
  state.listEquipment.mockResolvedValue([]);
  state.basketUpdateTitle.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("creating a recipe", () => {
  it("asks for nothing until it is told to", async () => {
    // A create-mode editor has no recipe to fetch, and the rules of hooks mean
    // the fetch cannot simply be skipped — so it has to be a no-op.
    renderHook(() => useRecipeEditor());

    await waitFor(() => expect(state.listEquipment).toHaveBeenCalled());
    expect(state.getRecipe).not.toHaveBeenCalled();
    expect(state.forRecipe).not.toHaveBeenCalled();
  });

  it("is not saveable until a title is typed", async () => {
    const { result } = renderHook(() => useRecipeEditor());

    expect(result.current.canSave).toBe(false);
    act(() => result.current.setTitle("Chilli"));
    expect(result.current.canSave).toBe(true);
  });

  it("does nothing when save is called on an empty draft", async () => {
    const { result } = renderHook(() => useRecipeEditor());
    await act(async () => {
      expect(await result.current.save()).toBeNull();
    });

    expect(state.createRecipe).not.toHaveBeenCalled();
  });

  it("parses the field text on the way out", async () => {
    const { result } = renderHook(() => useRecipeEditor());
    act(() => {
      result.current.setTitle("  Chilli  ");
      result.current.setServings("4");
      result.current.setTotalMinutes("45");
      result.current.setTags(["weeknight"]);
    });
    await act(async () => {
      expect(await result.current.save()).toBe("new-1");
    });

    expect(state.createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Chilli", servings: 4, totalMinutes: 45 }),
    );
  });

  it("sends an unparseable yield as unknown rather than as a number", async () => {
    // Blank and junk both mean "we don't know", which is a different answer
    // from zero and must not be invented (BL-0035).
    const { result } = renderHook(() => useRecipeEditor());
    act(() => {
      result.current.setTitle("Chilli");
      result.current.setServings("lots");
    });
    await act(() => result.current.save());

    expect(state.createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ servings: undefined }),
    );
  });

  it("reports a failed create instead of claiming an id", async () => {
    state.createRecipe.mockRejectedValueOnce(new Error("400"));

    const { result } = renderHook(() => useRecipeEditor());
    act(() => result.current.setTitle("Chilli"));
    await act(async () => {
      expect(await result.current.save()).toBeNull();
    });

    expect(result.current.error).toBe("400");
  });
});

describe("importing from a URL", () => {
  it("does not import an empty box", async () => {
    const { result } = renderHook(() => useRecipeEditor());
    await act(() => result.current.importRecipe());

    expect(state.importFromUrl).not.toHaveBeenCalled();
  });

  it("fills the draft for review and never saves", async () => {
    // The review step is the whole point of the funnel (BL-0020): a parse is
    // corrected before it is stored, not after.
    const { result } = renderHook(() => useRecipeEditor());
    act(() => result.current.setUrl("https://example.test/chilli"));
    await act(() => result.current.importRecipe());

    expect(state.importFromUrl).toHaveBeenCalledWith({ url: "https://example.test/chilli" });
    expect(result.current.draft.title).toBe("Chilli");
    expect(result.current.draft.servings).toBe("4");
    expect(result.current.draft.totalMinutes).toBe("45");
    expect(state.createRecipe).not.toHaveBeenCalled();
  });

  it("drops a rule-derived prep task rather than freezing a copy of the rule", async () => {
    state.importFromUrl.mockResolvedValue(
      recipe({
        prepTasks: [
          { key: "thaw", window: "night_before", text: "Thaw it", source: "rule" },
          { key: "soak", window: "night_before", text: "Soak them", source: "llm" },
        ],
      }),
    );

    const { result } = renderHook(() => useRecipeEditor());
    act(() => result.current.setUrl("https://example.test/chilli"));
    await act(() => result.current.importRecipe());

    expect(result.current.draft.prepTasks).toEqual([
      { key: "soak", window: "night_before", text: "Soak them", source: "llm" },
    ]);
  });

  it("reports a failed import without disturbing what is already typed", async () => {
    state.importFromUrl.mockRejectedValueOnce(new Error("could not read that page"));

    const { result } = renderHook(() => useRecipeEditor());
    act(() => {
      result.current.setTitle("My own title");
      result.current.setUrl("https://example.test/nope");
    });
    await act(() => result.current.importRecipe());

    expect(result.current.importError).toBe("could not read that page");
    expect(result.current.draft.title).toBe("My own title");
  });
});

describe("editing a stored recipe", () => {
  async function editing(recipeId = "r1") {
    const view = renderHook(() => useRecipeEditor(recipeId));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
  }

  it("seeds the draft from what is stored", async () => {
    const { result } = await editing();

    await waitFor(() => expect(result.current.draft.title).toBe("Chilli"));
    expect(result.current.draft.servings).toBe("4");
    expect(result.current.draft.cuisine).toBe("mexican");
  });

  it("never re-seeds over what the user has since typed", async () => {
    const { rerender, result } = await editing();
    await waitFor(() => expect(result.current.draft.title).toBe("Chilli"));

    act(() => result.current.setTitle("Chilli con carne"));
    rerender();

    expect(result.current.draft.title).toBe("Chilli con carne");
  });

  it("sends every field, because update replaces the recipe", async () => {
    const { result } = await editing();
    await waitFor(() => expect(result.current.draft.title).toBe("Chilli"));
    await act(async () => {
      expect(await result.current.save()).toBe("r1");
    });

    expect(state.updateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "r1",
        title: "Chilli",
        servings: 4,
        totalMinutes: 45,
        cuisine: "mexican",
        tags: ["weeknight"],
      }),
    );
    expect(state.createRecipe).not.toHaveBeenCalled();
  });

  it("reconciles the basket title after the recipe itself is saved", async () => {
    const { result } = await editing();
    await waitFor(() => expect(result.current.draft.title).toBe("Chilli"));
    act(() => result.current.setTitle("Chilli con carne"));
    await act(() => result.current.save());

    expect(state.basketUpdateTitle).toHaveBeenCalledWith({
      recipeId: "r1",
      title: "Chilli con carne",
    });
  });

  it("keeps the save when only the basket reconciliation fails", async () => {
    // The recipe-service write is the source of truth; a stale basket title is
    // a smaller problem than an edit that appears to have failed.
    state.basketUpdateTitle.mockRejectedValueOnce(new Error("offline"));

    const { result } = await editing();
    await waitFor(() => expect(result.current.draft.title).toBe("Chilli"));
    await act(async () => {
      expect(await result.current.save()).toBe("r1");
    });
  });

  it("reports a recipe that is gone as missing, not as an error", async () => {
    state.getRecipe.mockResolvedValue(null);

    const { result } = await editing("ghost");

    expect(result.current.missing).toBe(true);
    expect(result.current.loadError).toBeNull();
  });

  it("offers only derived prep for override — the user's own is already in the draft", async () => {
    state.forRecipe.mockResolvedValue(
      prep([
        {
          key: "thaw",
          ruleId: "thaw_frozen_protein",
          subject: "beef",
          window: "night_before",
          text: "Thaw it",
          dueOn: "2026-08-04",
          source: "rule",
        },
        {
          key: "mine",
          ruleId: "manual",
          subject: "",
          window: "morning_of",
          text: "Mine",
          dueOn: "2026-08-05",
          source: "manual",
        },
      ]),
    );

    const { result } = await editing();

    await waitFor(() => expect(result.current.derivedPrep).toHaveLength(1));
    expect(result.current.derivedPrep[0].key).toBe("thaw");
  });
});
