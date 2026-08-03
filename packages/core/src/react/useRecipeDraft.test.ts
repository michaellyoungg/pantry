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
    expect(result.current.submission).toEqual({ title: "Toast", ingredients: [], steps: [] });
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
      ingredients: [{ quantity: 2, unit: "clove", item: "garlic" }],
      steps: [],
    });
  });

  it("holds step lines", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.setSteps(["Chop", "Fry"]));
    expect(result.current.draft.steps).toEqual(["Chop", "Fry"]);
  });

  it("adds and patches ingredient rows", () => {
    const { result } = renderHook(() => useRecipeDraft());
    act(() => result.current.addIngredient());
    act(() => result.current.updateIngredient(1, { item: "flour", quantity: 3 }));
    expect(result.current.draft.ingredients).toHaveLength(2);
    expect(result.current.draft.ingredients[1]).toEqual({ quantity: 3, unit: "", item: "flour" });
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
      steps: [],
      ingredients: [{ quantity: 1, unit: "", item: "" }],
    });
  });
});
