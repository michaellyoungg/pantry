import { describe, it, expect, vi, afterEach } from "vitest";
import { createRecipe, listRecipes } from "./recipeService";

afterEach(() => vi.restoreAllMocks());

describe("recipeService", () => {
  it("createRecipe POSTs to /recipes and returns the created recipe", async () => {
    const recipe = { id: "r1", userId: "dev-user", title: "Toast", ingredients: [], createdAt: "" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => recipe,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRecipe({ title: "Toast", ingredients: [] });
    expect(result).toEqual(recipe);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/recipes$/);
    expect(init.method).toBe("POST");
  });

  it("listRecipes GETs /recipes and returns the array", async () => {
    const recipes = [{ id: "r1", userId: "dev-user", title: "Toast", ingredients: [], createdAt: "" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => recipes }));
    const result = await listRecipes();
    expect(result).toEqual(recipes);
  });

  it("createRecipe throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(createRecipe({ title: "", ingredients: [] })).rejects.toThrow();
  });
});
