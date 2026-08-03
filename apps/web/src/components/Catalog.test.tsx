import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: { listCatalog: "recipes.listCatalog" },
    basket: { add: "basket.add" },
    preferences: { get: "preferences.get" },
  },
}));

const { listCatalog, addMock, household } = vi.hoisted(() => {
  const addMock = vi.fn(() => Promise.resolve()) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: (u: unknown) => typeof addMock;
  };
  addMock.withOptimisticUpdate = () => addMock;
  return {
    listCatalog: vi.fn(),
    addMock,
    household: { prefs: { householdSize: undefined } as { householdSize?: number } },
  };
});

vi.mock("convex/react", () => ({
  useAction: () => listCatalog,
  useMutation: () => addMock,
  useQuery: () => household.prefs,
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

  it("shows a loading state before the fetch resolves (not the empty state)", () => {
    listCatalog.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Catalog />);
    expect(screen.getByText(/loading catalog/i)).toBeTruthy();
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
  });

  it("shows an error with retry (not the empty state) when the fetch fails", async () => {
    listCatalog.mockRejectedValueOnce(new Error("backend down")).mockResolvedValue([CAT]);
    render(<Catalog />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/backend down/i);
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Garlic Bread");
  });
});

describe("Catalog seeds the servings dial from household size (BL-0018)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    household.prefs = { householdSize: undefined };
  });

  it("halves a catalog recipe that feeds twice the household", async () => {
    household.prefs = { householdSize: 2 };
    listCatalog.mockResolvedValue([{ ...CAT, servings: 4 }]);

    render(<Catalog />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ recipeId: CAT.id, servingsMultiplier: 0.5 }),
      ),
    );
  });

  it("sends no multiplier when there is nothing to derive one from", async () => {
    listCatalog.mockResolvedValue([CAT]);

    render(<Catalog />);
    await screen.findByText("Garlic Bread");
    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ servingsMultiplier: undefined }),
      ),
    );
  });
});
