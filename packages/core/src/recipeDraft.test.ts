import { describe, expect, it } from "vitest";
import {
  draftImportUrl,
  draftSubmission,
  emptyDraft,
  emptyIngredient,
  withEquipment,
  withExtraIngredient,
  withImportedRecipe,
  withIngredientPatch,
  withMethods,
  withServings,
  withSteps,
} from "./recipeDraft";

describe("emptyDraft", () => {
  it("starts blank with one ingredient row to type into", () => {
    const draft = emptyDraft();
    expect(draft.title).toBe("");
    expect(draft.url).toBe("");
    expect(draft.ingredients).toEqual([emptyIngredient()]);
    expect(draft.steps).toEqual([]);
    expect(draft.servings).toBe("");
  });

  it("hands out a fresh object each call", () => {
    expect(emptyDraft().ingredients).not.toBe(emptyDraft().ingredients);
  });
});

describe("withImportedRecipe", () => {
  it("adopts the parsed title and ingredients", () => {
    const draft = withImportedRecipe(emptyDraft(), {
      title: "Garlic Bread",
      ingredients: [{ quantity: 2, unit: "clove", item: "garlic", note: "minced" }],
    });
    expect(draft.title).toBe("Garlic Bread");
    expect(draft.ingredients).toEqual([
      { quantity: 2, unit: "clove", item: "garlic", note: "minced" },
    ]);
  });

  it("adopts parsed steps, and an import without any leaves none", () => {
    expect(
      withImportedRecipe(emptyDraft(), { title: "X", ingredients: [], steps: ["Mix", "Bake"] })
        .steps,
    ).toEqual(["Mix", "Bake"]);
    expect(withImportedRecipe(emptyDraft(), { title: "X", ingredients: [] }).steps).toEqual([]);
  });

  it("adopts an imported servings string, and blanks it when the import had none", () => {
    expect(
      withImportedRecipe(emptyDraft(), { title: "X", ingredients: [], servings: "4" }).servings,
    ).toBe("4");
    expect(withImportedRecipe(emptyDraft(), { title: "X", ingredients: [] }).servings).toBe("");
  });

  it("keeps one blank row when the import yielded no ingredients", () => {
    const draft = withImportedRecipe(emptyDraft(), { title: "Mystery", ingredients: [] });
    expect(draft.ingredients).toEqual([emptyIngredient()]);
  });

  it("leaves the URL being imported from in place", () => {
    const draft = withImportedRecipe(
      { ...emptyDraft(), url: "https://example.com/x" },
      { title: "X", ingredients: [] },
    );
    expect(draft.url).toBe("https://example.com/x");
  });
});

describe("withIngredientPatch", () => {
  it("patches only the addressed row", () => {
    const draft = withExtraIngredient(emptyDraft());
    const patched = withIngredientPatch(draft, 1, { item: "flour", quantity: 3 });
    expect(patched.ingredients[0]).toEqual(emptyIngredient());
    expect(patched.ingredients[1]).toEqual({ quantity: 3, unit: "", item: "flour" });
  });

  it("does not mutate the previous draft", () => {
    const draft = emptyDraft();
    withIngredientPatch(draft, 0, { item: "flour" });
    expect(draft.ingredients[0].item).toBe("");
  });

  it("is a no-op for an index that isn't there", () => {
    const draft = emptyDraft();
    expect(withIngredientPatch(draft, 5, { item: "flour" }).ingredients).toEqual(draft.ingredients);
  });
});

describe("withExtraIngredient", () => {
  it("appends a blank row", () => {
    const draft = withExtraIngredient(emptyDraft());
    expect(draft.ingredients).toHaveLength(2);
    expect(draft.ingredients[1]).toEqual(emptyIngredient());
  });
});

describe("withSteps", () => {
  it("replaces the step lines", () => {
    expect(withSteps(emptyDraft(), ["Chop", "Fry"]).steps).toEqual(["Chop", "Fry"]);
  });
});

describe("withServings", () => {
  it("replaces the raw yield text without interpreting it", () => {
    // Parsing belongs to the client — the draft holds exactly what was typed.
    expect(withServings(emptyDraft(), "  not a number ").servings).toBe("  not a number ");
  });
});

describe("withEquipment / withMethods", () => {
  it("replaces the tag lists wholesale", () => {
    const tagged = withMethods(withEquipment(emptyDraft(), [{ id: "smoker", required: true }]), [
      "smoke",
    ]);
    expect(tagged.equipment).toEqual([{ id: "smoker", required: true }]);
    expect(tagged.methods).toEqual(["smoke"]);
    // Correcting a guess means replacing it, not accumulating alternatives.
    expect(withEquipment(tagged, [{ id: "oven", required: false }]).equipment).toEqual([
      { id: "oven", required: false },
    ]);
  });
});

describe("draftSubmission", () => {
  it("is null while the title is blank or whitespace", () => {
    expect(draftSubmission(emptyDraft())).toBeNull();
    expect(draftSubmission({ ...emptyDraft(), title: "   " })).toBeNull();
  });

  it("trims the title and drops blank ingredient rows and step lines", () => {
    const submission = draftSubmission({
      title: "  Toast  ",
      url: "",
      servings: "4",
      equipment: [{ id: "toaster_oven", required: true }],
      methods: ["bake"],
      cuisine: "  italian ",
      totalMinutes: "20",
      tags: ["vegetarian"],
      sourceUrl: " https://example.com/toast ",
      prepTasks: [
        { window: "night_before", text: "Set the bread out" },
        { window: "at_start", text: "   " },
      ],
      steps: ["  Toast the bread  ", "   ", ""],
      ingredients: [
        { quantity: 2, unit: "slice", item: "bread" },
        emptyIngredient(),
        { quantity: 1, unit: "", item: "   " },
      ],
    });
    expect(submission).toEqual({
      title: "Toast",
      servings: "4",
      ingredients: [{ quantity: 2, unit: "slice", item: "bread" }],
      steps: ["Toast the bread"],
      equipment: [{ id: "toaster_oven", required: true }],
      methods: ["bake"],
      cuisine: "italian",
      totalMinutes: "20",
      tags: ["vegetarian"],
      sourceUrl: "https://example.com/toast",
      // Blank prep rows are scaffolding, exactly like blank ingredient rows.
      prepTasks: [{ window: "night_before", text: "Set the bread out" }],
    });
  });
});

describe("draftImportUrl", () => {
  it("is null when there is nothing to import", () => {
    expect(draftImportUrl(emptyDraft())).toBeNull();
    expect(draftImportUrl({ ...emptyDraft(), url: "   " })).toBeNull();
  });

  it("trims the URL", () => {
    expect(draftImportUrl({ ...emptyDraft(), url: "  https://example.com/x " })).toBe(
      "https://example.com/x",
    );
  });
});
