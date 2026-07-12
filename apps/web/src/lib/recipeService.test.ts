import { describe, it, expect, vi, afterEach } from "vitest";
import { createRecipe, listRecipes, deleteRecipe, updateRecipe, listCatalog } from "./recipeService";

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

  it("deleteRecipe DELETEs /recipes/{id} and resolves on ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await deleteRecipe("r1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/recipes\/r1$/);
    expect(init.method).toBe("DELETE");
  });

  it("deleteRecipe throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(deleteRecipe("nope")).rejects.toThrow();
  });

  it("updateRecipe PUTs /recipes/{id} and returns the updated recipe", async () => {
    const updated = { id: "r1", userId: "dev-user", title: "French Toast", ingredients: [], createdAt: "" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateRecipe("r1", { title: "French Toast", ingredients: [] });
    expect(result).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/recipes\/r1$/);
    expect(init.method).toBe("PUT");
  });

  it("updateRecipe throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(updateRecipe("nope", { title: "X", ingredients: [] })).rejects.toThrow();
  });

  it("listCatalog GETs /catalog and returns the array", async () => {
    const recipes = [{ id: "cat-garlic-bread", userId: "catalog", title: "Garlic Bread", ingredients: [], createdAt: "" }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => recipes });
    vi.stubGlobal("fetch", fetchMock);
    const result = await listCatalog();
    expect(result).toEqual(recipes);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/catalog$/);
  });

  it("listCatalog throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(listCatalog()).rejects.toThrow();
  });
});
