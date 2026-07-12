import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { addMock } = vi.hoisted(() => ({ addMock: vi.fn(() => Promise.resolve()) }));

vi.mock("convex/react", () => ({
  useMutation: () => addMock,
}));

vi.mock("../lib/recipeService", () => ({
  listCatalog: vi.fn(),
}));

import { Catalog } from "./Catalog";
import { listCatalog } from "../lib/recipeService";

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
    vi.mocked(listCatalog).mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith({ recipeId: "cat-garlic-bread", title: "Garlic Bread" }),
    );
  });

  it("shows an empty state when the catalog is empty", async () => {
    vi.mocked(listCatalog).mockResolvedValue([]);
    render(<Catalog />);
    await screen.findByText(/no catalog recipes/i);
  });
});
