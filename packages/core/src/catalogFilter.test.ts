import type { Recipe } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  applyCatalogFilter,
  type CatalogFilter,
  cuisinesIn,
  dietsIn,
  emptyCatalogFilter,
  isFilterActive,
  toggleFacet,
} from "./catalogFilter";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: "catalog",
    title: "Weeknight chilli",
    ingredients: [{ item: "kidney beans", quantity: 1, unit: "tin" }],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    prepTasks: [],
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const filter = (over: Partial<CatalogFilter> = {}): CatalogFilter => ({
  ...emptyCatalogFilter,
  ...over,
});

describe("free-text search", () => {
  const catalog = [
    recipe({ id: "a", title: "Weeknight chilli", cuisine: "mexican", tags: ["vegan"] }),
    recipe({
      id: "b",
      title: "Roast chicken",
      ingredients: [{ item: "Whole chicken", quantity: 1, unit: "" }],
    }),
  ];

  it("shows everything when nothing has been typed", () => {
    expect(applyCatalogFilter(catalog, filter()).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("matches the title, case-insensitively", () => {
    expect(applyCatalogFilter(catalog, filter({ query: "CHILLI" })).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  it("matches an ingredient, so 'what can I do with chicken' works", () => {
    expect(applyCatalogFilter(catalog, filter({ query: "chicken" })).map((r) => r.id)).toEqual([
      "b",
    ]);
  });

  it("matches a tag, which is what keeps the open vocabulary findable", () => {
    expect(applyCatalogFilter(catalog, filter({ query: "vegan" })).map((r) => r.id)).toEqual(["a"]);
  });

  it("matches the cuisine", () => {
    expect(applyCatalogFilter(catalog, filter({ query: "mexican" })).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  it("ignores surrounding whitespace rather than matching nothing", () => {
    expect(applyCatalogFilter(catalog, filter({ query: "  chilli " })).map((r) => r.id)).toEqual([
      "a",
    ]);
  });
});

describe("the cook-time bucket", () => {
  const catalog = [
    recipe({ id: "fast", totalMinutes: 12 }),
    recipe({ id: "medium", totalMinutes: 45 }),
    recipe({ id: "untimed", totalMinutes: undefined }),
  ];

  it("is an upper bound, so a 12-minute recipe is under 30", () => {
    expect(applyCatalogFilter(catalog, filter({ cookTime: "30" })).map((r) => r.id)).toEqual([
      "fast",
    ]);
  });

  it("never rounds an unknown cook time into 'fast'", () => {
    // The whole point of the weeknight filter is that it can be trusted.
    expect(applyCatalogFilter(catalog, filter({ cookTime: "60" })).map((r) => r.id)).toEqual([
      "fast",
      "medium",
    ]);
  });
});

describe("chip groups", () => {
  const catalog = [
    recipe({ id: "a", cuisine: "italian", tags: ["vegan"], totalMinutes: 20 }),
    recipe({ id: "b", cuisine: "italian", tags: ["vegetarian"], totalMinutes: 90 }),
    recipe({ id: "c", cuisine: "thai", tags: ["vegan"] }),
  ];

  it("ORs values inside one group", () => {
    expect(
      applyCatalogFilter(catalog, filter({ diets: ["vegan", "vegetarian"] })).map((r) => r.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("ANDs across groups", () => {
    expect(
      applyCatalogFilter(catalog, filter({ diets: ["vegan"], cuisines: ["italian"] })).map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });

  it("matches no recipe against a cuisine the catalog does not hold", () => {
    expect(applyCatalogFilter(catalog, filter({ cuisines: ["french"] }))).toEqual([]);
  });

  it("offers only cuisines present in the catalog, sorted", () => {
    expect(cuisinesIn(catalog)).toEqual(["italian", "thai"]);
  });

  it("offers only diet chips the catalog can satisfy, in the canonical order", () => {
    expect(dietsIn(catalog)).toEqual(["vegetarian", "vegan"]);
  });

  it("offers no chip at all for a catalog with no metadata", () => {
    expect(cuisinesIn([recipe({ cuisine: undefined })])).toEqual([]);
    expect(dietsIn([recipe({ tags: [] })])).toEqual([]);
  });
});

describe("isFilterActive", () => {
  it("is false for the empty selection, so 'clear filters' stays hidden", () => {
    expect(isFilterActive(emptyCatalogFilter)).toBe(false);
  });

  it("ignores a query of only whitespace", () => {
    expect(isFilterActive(filter({ query: "   " }))).toBe(false);
  });

  it.each([
    ["a query", filter({ query: "chilli" })],
    ["a cook time", filter({ cookTime: "15" })],
    ["a diet", filter({ diets: ["vegan"] })],
    ["a cuisine", filter({ cuisines: ["thai"] })],
  ])("is true once %s is chosen", (_label, value) => {
    expect(isFilterActive(value)).toBe(true);
  });
});

describe("toggleFacet", () => {
  it("adds a value that is not selected", () => {
    expect(toggleFacet(["vegan"], "vegetarian")).toEqual(["vegan", "vegetarian"]);
  });

  it("removes one that is", () => {
    expect(toggleFacet(["vegan", "vegetarian"], "vegan")).toEqual(["vegetarian"]);
  });

  it("does not mutate the list it was given", () => {
    const before = ["vegan"];
    toggleFacet(before, "vegetarian");
    expect(before).toEqual(["vegan"]);
  });
});
