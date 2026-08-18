import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroceryAddItem } from "./GroceryAddItem";

// The field hands the raw text straight to the data layer: splitting "2 lb
// butter" apart is `parseManualEntry`'s job and is proven in the hook's own
// suite, so what is left to test here is only the field's behaviour.
const onAdd = vi.fn();

beforeEach(() => vi.clearAllMocks());

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Add an item"), { target: { value } });
}

describe("GroceryAddItem", () => {
  it("sends what was typed, unparsed", () => {
    render(<GroceryAddItem recent={[]} onAdd={onAdd} />);
    type("2 lb butter");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith("2 lb butter");
  });

  it("submits on Enter, so adding never needs a second tap", () => {
    render(<GroceryAddItem recent={[]} onAdd={onAdd} />);
    type("foil");
    fireEvent.submit(screen.getByLabelText("Add an item"));

    expect(onAdd).toHaveBeenCalledWith("foil");
  });

  it("clears the field after adding", () => {
    render(<GroceryAddItem recent={[]} onAdd={onAdd} />);
    type("foil");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect((screen.getByLabelText("Add an item") as HTMLInputElement).value).toBe("");
  });

  it("cannot be submitted empty", () => {
    render(<GroceryAddItem recent={[]} onAdd={onAdd} />);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers recent items as one-tap chips", () => {
    render(<GroceryAddItem recent={[{ canonicalItem: "milk", display: "Milk" }]} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Milk" }));

    expect(onAdd).toHaveBeenCalledWith("Milk");
  });

  it("shows no chip row when there is nothing to suggest", () => {
    render(<GroceryAddItem recent={[]} onAdd={onAdd} />);
    expect(screen.queryByRole("button", { name: /milk/i })).toBeNull();
  });
});
