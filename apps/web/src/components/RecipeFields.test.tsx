import type { Ingredient } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cleanIngredients, RecipeFields, type RecipeFieldsValue } from "./RecipeFields";

function value(over: Partial<RecipeFieldsValue> = {}): RecipeFieldsValue {
  return {
    title: "Toast",
    servings: "",
    ingredients: [{ quantity: 2, unit: "clove", item: "garlic" }],
    steps: [],
    equipment: [],
    methods: [],
    cuisine: "",
    totalMinutes: "",
    tags: "",
    ...over,
  };
}

function renderFields(over: Partial<RecipeFieldsValue> = {}) {
  const onChange = vi.fn();
  render(<RecipeFields value={value(over)} onChange={onChange} catalog={[]} />);
  return onChange;
}

describe("RecipeFields", () => {
  it("reports title edits", () => {
    const onChange = renderFields();
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Toasts" } });
    expect(onChange).toHaveBeenCalledWith({ title: "Toasts" });
  });

  it("reports an ingredient edit at the right index", () => {
    const onChange = renderFields();
    fireEvent.change(screen.getByPlaceholderText("item"), { target: { value: "onion" } });
    expect(onChange).toHaveBeenCalledWith({
      ingredients: [{ quantity: 2, unit: "clove", item: "onion" }],
    });
  });

  it("appends an empty ingredient row", () => {
    const onChange = renderFields();
    fireEvent.click(screen.getByRole("button", { name: /\+ ingredient/i }));
    expect(onChange).toHaveBeenCalledWith({
      ingredients: [
        { quantity: 2, unit: "clove", item: "garlic" },
        { quantity: 1, unit: "", item: "" },
      ],
    });
  });

  // The discovery fields are on the shared surface, so an import that parsed
  // them can be corrected before saving rather than saved silently.
  it("reports cook time, cuisine and tag edits", () => {
    const onChange = renderFields();

    fireEvent.change(screen.getByLabelText(/cook time/i), { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith({ totalMinutes: "35" });

    fireEvent.change(screen.getByLabelText(/cuisine/i), { target: { value: "Thai" } });
    expect(onChange).toHaveBeenCalledWith({ cuisine: "Thai" });

    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: "vegan, quick" } });
    expect(onChange).toHaveBeenCalledWith({ tags: "vegan, quick" });
  });

  it("shows the values it is given", () => {
    renderFields({ cuisine: "italian", totalMinutes: "20", tags: "vegan, weeknight" });
    expect((screen.getByLabelText(/cuisine/i) as HTMLInputElement).value).toBe("italian");
    expect((screen.getByLabelText(/cook time/i) as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText(/tags/i) as HTMLInputElement).value).toBe("vegan, weeknight");
  });
});

describe("cleanIngredients", () => {
  it("drops rows whose item is blank or whitespace", () => {
    const rows: Ingredient[] = [
      { quantity: 1, unit: "", item: "flour" },
      { quantity: 2, unit: "", item: "  " },
      { quantity: 1, unit: "cup", item: "milk" },
    ];
    expect(cleanIngredients(rows)).toEqual([
      { quantity: 1, unit: "", item: "flour" },
      { quantity: 1, unit: "cup", item: "milk" },
    ]);
  });
});
