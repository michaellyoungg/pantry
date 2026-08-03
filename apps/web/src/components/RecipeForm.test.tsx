import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: {
      create: "recipes.create",
      importFromUrl: "recipes.importFromUrl",
      listEquipment: "recipes.listEquipment",
    },
  },
}));

const { createMock, importMock, listEquipmentMock } = vi.hoisted(() => ({
  createMock: vi.fn(() => Promise.resolve({ id: "r1" })),
  importMock: vi.fn(),
  listEquipmentMock: vi.fn(() =>
    Promise.resolve([
      { id: "oven", name: "Oven", category: "appliance", aliases: ["oven"] },
      { id: "sheet_pan", name: "Sheet pan", category: "cookware", aliases: ["sheet pan"] },
    ]),
  ),
}));

vi.mock("convex/react", () => ({
  // useAction is called with the api function reference; dispatch by it.
  useAction: (ref: string) =>
    ref === "recipes.importFromUrl"
      ? importMock
      : ref === "recipes.listEquipment"
        ? listEquipmentMock
        : createMock,
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
      steps: ["Mince the garlic.", "Toast the bread."],
      equipment: [{ id: "oven", required: true }],
      methods: ["bake"],
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
    // Imported steps populate the steps editor and are saved on create.
    expect(screen.getByDisplayValue("Mince the garlic.")).toBeTruthy();
    expect(screen.getByDisplayValue("Toast the bread.")).toBeTruthy();

    // Import's deterministic equipment/method tags land in the editor, resolved
    // to catalog display names rather than raw slugs.
    await waitFor(() => expect(screen.getByText("Oven")).toBeTruthy());
    expect((screen.getByLabelText("Bake") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /create recipe/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Garlic Bread",
        steps: ["Mince the garlic.", "Toast the bread."],
        equipment: [{ id: "oven", required: true }],
        methods: ["bake"],
      }),
    );
  });

  it("lets the user correct a wrong guess before saving", async () => {
    importMock.mockResolvedValue({
      id: "",
      userId: "u1",
      title: "Garlic Bread",
      ingredients: [{ quantity: 1, unit: "loaf", item: "baguette" }],
      steps: ["Toast the bread."],
      equipment: [{ id: "oven", required: true }],
      methods: ["bake"],
      createdAt: "",
    });

    render(<RecipeForm onCreated={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/paste a recipe url/i), {
      target: { value: "https://example.com/garlic-bread" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(screen.getByText("Oven")).toBeTruthy());

    // Demote the detected oven to optional, then add the sheet pan the scan missed.
    fireEvent.click(screen.getByRole("button", { name: /mark oven as optional/i }));
    fireEvent.change(screen.getByLabelText("Add equipment"), { target: { value: "sheet_pan" } });

    fireEvent.click(screen.getByRole("button", { name: /create recipe/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        equipment: [
          { id: "oven", required: false },
          { id: "sheet_pan", required: true },
        ],
      }),
    );
  });
});
