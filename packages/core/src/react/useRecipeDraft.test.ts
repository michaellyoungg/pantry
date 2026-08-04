// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRecipeDraft } from "./useRecipeDraft";

describe("useRecipeDraft", () => {
  it("starts on an empty draft that isn't submittable", () => {
    const { result } = renderHook(() => useRecipeDraft());
    expect(result.current.draft.title).toBe("");
    expect(result.current.submission).toBeNull();
    expect(result.current.importUrl).toBeNull();
  });

  it("becomes submittable once a title is typed", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setTitle("Toast"));
    expect(result.current.submission).toEqual({
      title: "Toast",
      servings: "",
      ingredients: [],
      steps: [],
      equipment: [],
      methods: [],
      cuisine: "",
      totalMinutes: "",
      tags: [],
      sourceUrl: "",
      prepTasks: [],
    });
  });

  it("exposes the trimmed URL to import", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setUrl("  https://example.com/x "));
    expect(result.current.importUrl).toBe("https://example.com/x");
  });

  it("populates the draft from an imported recipe", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() =>
      result.current.applyImported({
        title: "Garlic Bread",
        ingredients: [{ quantity: 2, unit: "clove", item: "garlic" }],
      }),
    );
    expect(result.current.draft.title).toBe("Garlic Bread");
    expect(result.current.submission).toEqual({
      title: "Garlic Bread",
      servings: "",
      ingredients: [{ quantity: 2, unit: "clove", item: "garlic" }],
      steps: [],
      equipment: [],
      methods: [],
      cuisine: "",
      totalMinutes: "",
      tags: [],
      sourceUrl: "",
      prepTasks: [],
    });
  });

  it("carries hand-authored prep tasks into the submission, dropping blank rows", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => {
      result.current.setTitle("Roast");
      result.current.setPrepTasks([
        { window: "night_before", text: "Take the turkey out" },
        { window: "at_start", text: "  " },
      ]);
    });
    expect(result.current.submission?.prepTasks).toEqual([
      { window: "night_before", text: "Take the turkey out" },
    ]);
  });

  // Import is the only producer of `llm` tasks, and they have to survive review
  // or the model's work is thrown away on the way to the save.
  it("keeps model-derived prep from an import", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() =>
      result.current.applyImported({
        title: "Pulled pork",
        ingredients: [{ quantity: 2, unit: "kg", item: "pork shoulder" }],
        prepTasks: [{ window: "morning_of", text: "Start the smoker", source: "llm" }],
      }),
    );
    expect(result.current.submission?.prepTasks).toEqual([
      { window: "morning_of", text: "Start the smoker", source: "llm" },
    ]);
  });

  it("holds step lines", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setSteps(["Chop", "Fry"]));
    expect(result.current.draft.steps).toEqual(["Chop", "Fry"]);
  });

  it("holds the raw servings text", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setServings("6"));
    expect(result.current.draft.servings).toBe("6");
  });

  it("adds and patches ingredient rows", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.addIngredient());
    act(() => result.current.updateIngredient(1, { item: "flour", quantity: 3 }));
    expect(result.current.draft.ingredients).toHaveLength(2);
    expect(result.current.draft.ingredients[1]).toEqual({ quantity: 3, unit: "", item: "flour" });
  });

  it("holds equipment and method tags and carries them into the submission", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setTitle("Brisket"));
    act(() => result.current.setEquipment([{ id: "smoker", required: true }]));
    act(() => result.current.setMethods(["smoke"]));
    expect(result.current.draft.equipment).toEqual([{ id: "smoker", required: true }]);
    expect(result.current.submission?.equipment).toEqual([{ id: "smoker", required: true }]);
    expect(result.current.submission?.methods).toEqual(["smoke"]);
  });

  it("holds the discovery metadata and carries it into the submission", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setTitle("Pad Thai"));
    act(() => result.current.setCuisine("Thai"));
    act(() => result.current.setTotalMinutes("35"));
    act(() => result.current.setTags(["weeknight", "gluten free"]));
    expect(result.current.submission?.cuisine).toBe("Thai");
    // Raw field text, like servings: parsing belongs to the client.
    expect(result.current.submission?.totalMinutes).toBe("35");
    expect(result.current.submission?.tags).toEqual(["weeknight", "gluten free"]);
  });

  it("carries an imported source url through to the submission", () => {
    // Attribution has to survive the review step, or an imported recipe saves
    // with no link back to where it came from.
    const { result } = renderHook(() => useRecipeDraft());
    act(() =>
      result.current.applyImported({
        title: "Pad Thai",
        ingredients: [],
        cuisine: "thai",
        totalMinutes: "35",
        tags: ["weeknight"],
        sourceUrl: "https://example.com/pad-thai",
      }),
    );
    expect(result.current.submission?.sourceUrl).toBe("https://example.com/pad-thai");
    expect(result.current.submission?.cuisine).toBe("thai");
    expect(result.current.submission?.tags).toEqual(["weeknight"]);
  });

  it("replaces the whole ingredient list when the editor reports one", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setIngredients([{ quantity: 2, unit: "cup", item: "flour" }]));
    expect(result.current.draft.ingredients).toEqual([{ quantity: 2, unit: "cup", item: "flour" }]);
  });

  it("reset returns to a fresh empty draft", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => {
      result.current.setTitle("Toast");
      result.current.setUrl("https://example.com/x");
    });
    act(() => result.current.reset());
    expect(result.current.draft).toEqual({
      title: "",
      url: "",
      servings: "",
      steps: [],
      ingredients: [{ quantity: 1, unit: "", item: "" }],
      equipment: [],
      methods: [],
      cuisine: "",
      totalMinutes: "",
      tags: [],
      sourceUrl: "",
      prepTasks: [],
    });
  });
});
