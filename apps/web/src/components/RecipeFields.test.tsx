import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cleanIngredients, RecipeFields } from "./RecipeFields";

const ings = [{ quantity: 2, unit: "clove", item: "garlic" }];

describe("RecipeFields", () => {
  it("reports title edits", () => {
    const onTitleChange = vi.fn();
    render(
      <RecipeFields
        title="Toast"
        ingredients={ings}
        onTitleChange={onTitleChange}
        onIngredientsChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Toasts" } });
    expect(onTitleChange).toHaveBeenCalledWith("Toasts");
  });

  it("reports an ingredient edit at the right index", () => {
    const onIngredientsChange = vi.fn();
    render(
      <RecipeFields
        title=""
        ingredients={ings}
        onTitleChange={() => {}}
        onIngredientsChange={onIngredientsChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("item"), { target: { value: "onion" } });
    expect(onIngredientsChange).toHaveBeenCalledWith([
      { quantity: 2, unit: "clove", item: "onion" },
    ]);
  });

  it("appends an empty ingredient row", () => {
    const onIngredientsChange = vi.fn();
    render(
      <RecipeFields
        title=""
        ingredients={ings}
        onTitleChange={() => {}}
        onIngredientsChange={onIngredientsChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ ingredient/i }));
    expect(onIngredientsChange).toHaveBeenCalledWith([
      { quantity: 2, unit: "clove", item: "garlic" },
      { quantity: 1, unit: "", item: "" },
    ]);
  });
});

describe("cleanIngredients", () => {
  it("drops rows whose item is blank or whitespace", () => {
    expect(
      cleanIngredients([
        { quantity: 1, unit: "", item: "flour" },
        { quantity: 2, unit: "", item: "  " },
        { quantity: 1, unit: "cup", item: "milk" },
      ]),
    ).toEqual([
      { quantity: 1, unit: "", item: "flour" },
      { quantity: 1, unit: "cup", item: "milk" },
    ]);
  });
});
