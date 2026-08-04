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
    prepTasks: [],
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

  // Prep authoring rides on the SHARED surface (BL-0044 on top of BL-0020), so
  // import review and the edit dialog get it from the same component rather
  // than each growing their own copy — which is the drift this component was
  // introduced to stop.
  it("reports prep task edits like any other field", () => {
    const onChange = renderFields({
      prepTasks: [{ window: "night_before", text: "Make the pastry" }],
    });
    fireEvent.change(screen.getByDisplayValue("Make the pastry"), {
      target: { value: "Make the pastry and chill it" },
    });
    expect(onChange).toHaveBeenCalledWith({
      prepTasks: [{ window: "night_before", text: "Make the pastry and chill it" }],
    });
  });

  it("offers a derived task for override only when there is a recipe to derive from", () => {
    const onChange = vi.fn();
    const { unmount } = render(<RecipeFields value={value()} onChange={onChange} catalog={[]} />);
    // Creating: nothing exists yet, so nothing is offered.
    expect(screen.queryByRole("button", { name: /^Override:/ })).toBeNull();
    unmount();

    render(
      <RecipeFields
        value={value()}
        onChange={onChange}
        catalog={[]}
        derivedPrep={[
          {
            key: "preheat_oven:bake",
            ruleId: "preheat_oven",
            subject: "bake",
            window: "at_start",
            text: "Preheat the oven",
            source: "rule",
            dueOn: "2026-08-10",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Override: Preheat the oven" }));
    expect(onChange).toHaveBeenCalledWith({
      prepTasks: [{ key: "preheat_oven:bake", window: "at_start", text: "Preheat the oven" }],
    });
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
