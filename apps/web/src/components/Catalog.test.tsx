import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { listCatalog: "recipes.listCatalog" },
    basket: { add: "basket.add" },
  },
}));

const { listCatalog, addMock } = vi.hoisted(() => ({
  listCatalog: vi.fn(),
  addMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useAction: () => listCatalog,
  useMutation: () => addMock,
}));

import { Catalog } from "./Catalog";

const CAT = {
  id: "cat-garlic-bread",
  userId: "catalog",
  title: "Garlic Bread",
  ingredients: [],
  createdAt: "",
};

describe("Catalog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders catalog recipes and adds one to the basket by reference", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith({ recipeId: "cat-garlic-bread", title: "Garlic Bread" }),
    );
  });

  it("shows an empty state when the catalog is empty", async () => {
    listCatalog.mockResolvedValue([]);
    render(<Catalog />);
    await screen.findByText(/no catalog recipes/i);
  });

  const TWO = [
    { id: "a", userId: "catalog", title: "Garlic Bread", ingredients: [], createdAt: "" },
    {
      id: "b",
      userId: "catalog",
      title: "Pancakes",
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
      createdAt: "",
    },
  ];

  it("filters the catalog by title as the query changes", async () => {
    listCatalog.mockResolvedValue(TWO);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "pan" } });
    expect(screen.queryByText("Garlic Bread")).toBeNull();
    expect(screen.getByText("Pancakes")).toBeTruthy();
  });

  it("also matches on ingredient names", async () => {
    listCatalog.mockResolvedValue(TWO);
    render(<Catalog />);
    await screen.findByText("Pancakes");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "flour" } });
    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });

  it("shows a no-match message when nothing matches the query", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "zzz" } });
    await screen.findByText(/no recipes match/i);
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });
});
