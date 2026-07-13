import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { create: "recipes.create", importFromUrl: "recipes.importFromUrl" },
  },
}));

const { createMock, importMock } = vi.hoisted(() => ({
  createMock: vi.fn(() => Promise.resolve({ id: "r1" })),
  importMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  // useAction is called with the api function reference; dispatch by it.
  useAction: (ref: string) => (ref === "recipes.importFromUrl" ? importMock : createMock),
}));

import { RecipeForm } from "./RecipeForm";

describe("RecipeForm import", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports a recipe and populates the form fields", async () => {
    importMock.mockResolvedValue({
      id: "",
      userId: "u1",
      title: "Garlic Bread",
      ingredients: [{ quantity: 2, unit: "clove", item: "garlic", note: "minced" }],
      createdAt: "",
    });

    render(<RecipeForm onCreated={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/paste a recipe url/i), {
      target: { value: "https://example.com/garlic-bread" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() =>
      expect(importMock).toHaveBeenCalledWith({ url: "https://example.com/garlic-bread" }),
    );
    // Title field is populated from the preview. getByDisplayValue throws if
    // the element is absent, so a truthy assertion is sufficient (this project's
    // vitest setup does not load jest-dom matchers).
    await waitFor(() => expect(screen.getByDisplayValue("Garlic Bread")).toBeTruthy());
    // Ingredient item is populated too.
    expect(screen.getByDisplayValue("garlic")).toBeTruthy();
  });
});
