import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, actionMock } = vi.hoisted(() => ({
  state: { recent: [] as Array<{ canonicalItem: string; display: string }> },
  actionMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.recent,
  useAction: () => actionMock,
}));

import { GroceryAddItem } from "./GroceryAddItem";

beforeEach(() => {
  vi.clearAllMocks();
  state.recent = [];
});

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Add an item"), { target: { value } });
}

describe("GroceryAddItem", () => {
  it("sends what was typed, split into quantity, unit and item", async () => {
    render(<GroceryAddItem />);
    type("2 lb butter");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith({ quantity: 2, unit: "lb", item: "butter" }),
    );
  });

  it("submits on Enter, so adding never needs a second tap", async () => {
    render(<GroceryAddItem />);
    type("foil");
    fireEvent.submit(screen.getByLabelText("Add an item"));

    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith({ quantity: 1, unit: "", item: "foil" }),
    );
  });

  it("clears the field after adding", async () => {
    render(<GroceryAddItem />);
    type("foil");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Add an item") as HTMLInputElement).value).toBe(""),
    );
  });

  it("cannot be submitted empty", () => {
    render(<GroceryAddItem />);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds nothing for whitespace that parses to no item", async () => {
    render(<GroceryAddItem />);
    type("  ");
    fireEvent.submit(screen.getByLabelText("Add an item"));
    await waitFor(() => expect(actionMock).not.toHaveBeenCalled());
  });

  it("offers recent items as one-tap chips", async () => {
    state.recent = [{ canonicalItem: "milk", display: "Milk" }];
    render(<GroceryAddItem />);
    fireEvent.click(screen.getByRole("button", { name: "Milk" }));

    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith({ quantity: 1, unit: "", item: "Milk" }),
    );
  });

  it("shows no chip row when there is nothing to suggest", () => {
    render(<GroceryAddItem />);
    expect(screen.queryByRole("button", { name: /milk/i })).toBeNull();
  });

  it("surfaces a failure inline instead of losing the item silently", async () => {
    actionMock.mockRejectedValueOnce(new Error("service down"));
    render(<GroceryAddItem />);
    type("foil");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("service down");
  });
});
