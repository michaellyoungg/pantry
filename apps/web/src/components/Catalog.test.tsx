import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pantry/convex/api", () => ({
  api: {
    recipes: {
      listCatalog: "recipes.listCatalog",
      addFromCatalog: "recipes.addFromCatalog",
    },
  },
}));

const { listCatalog, addFromCatalog } = vi.hoisted(() => ({
  listCatalog: vi.fn(),
  addFromCatalog: vi.fn(),
}));

// useTracedAction wraps useAction, so both catalog calls resolve through here.
vi.mock("convex/react", () => ({
  useAction: (ref: string) => (ref === "recipes.addFromCatalog" ? addFromCatalog : listCatalog),
  useMutation: () => vi.fn(),
}));

import { Catalog } from "./Catalog";

function recipe(over: Record<string, unknown> = {}) {
  return {
    id: "cat-garlic-bread",
    userId: "catalog",
    title: "Garlic Bread",
    ingredients: [],
    steps: [],
    equipment: [],
    methods: [],
    tags: [],
    createdAt: "",
    ...over,
  };
}

const CAT = recipe();

describe("Catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addFromCatalog.mockResolvedValue(recipe({ id: "r-clone", userId: "user-a" }));
  });

  it("adds a catalog recipe by cloning it, never by basketing the catalog id", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    // The clone endpoint owns both halves (copy + basket) so the two can never
    // disagree; the client must not reach for basket.add on the catalog id.
    await waitFor(() =>
      expect(addFromCatalog).toHaveBeenCalledWith({ catalogRecipeId: "cat-garlic-bread" }),
    );
  });

  it("marks a recipe as added so a second click cannot make a second copy", async () => {
    listCatalog.mockResolvedValue([CAT]);
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.click(screen.getByRole("button", { name: /add to basket/i }));
    const added = await screen.findByRole("button", { name: /added/i });
    expect((added as HTMLButtonElement).disabled).toBe(true);
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

describe("Catalog search", () => {
  const TWO = [
    recipe({ id: "cat-a", title: "Garlic Bread", tags: ["vegetarian"] }),
    recipe({
      id: "cat-b",
      title: "Pancakes",
      ingredients: [{ quantity: 1, unit: "cup", item: "flour" }],
      tags: ["breakfast"],
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    listCatalog.mockResolvedValue(TWO);
  });

  it("filters by title as the query changes", async () => {
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "pan" } });
    expect(screen.queryByText("Garlic Bread")).toBeNull();
    expect(screen.getByText("Pancakes")).toBeTruthy();
  });

  it("matches on ingredient names", async () => {
    render(<Catalog />);
    await screen.findByText("Pancakes");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "flour" } });
    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });

  // Tags are an open vocabulary, so most of them never get a chip. Search is
  // what keeps them useful rather than write-only.
  it("matches on tags that have no filter chip", async () => {
    render(<Catalog />);
    await screen.findByText("Pancakes");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "breakfast" } });
    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.queryByText("Garlic Bread")).toBeNull();
  });

  it("shows a no-match message with a way back", async () => {
    render(<Catalog />);
    await screen.findByText("Garlic Bread");

    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: "zzz" } });
    await screen.findByText(/no recipes match/i);
    expect(screen.queryByText("Garlic Bread")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Garlic Bread")).toBeTruthy();
  });
});

describe("Catalog filter chips", () => {
  const RECIPES = [
    recipe({
      id: "cat-quick",
      title: "Quick Salad",
      totalMinutes: 10,
      cuisine: "american",
      tags: ["vegan", "vegetarian"],
    }),
    recipe({
      id: "cat-slow",
      title: "Slow Roast",
      totalMinutes: 180,
      cuisine: "italian",
      tags: ["gluten-free"],
    }),
    // No cook time at all — the case the filter must not guess about.
    recipe({ id: "cat-unknown", title: "Mystery Stew", tags: ["vegetarian"] }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    listCatalog.mockResolvedValue(RECIPES);
  });

  it("filters by cook time", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /under 15 min/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.queryByText("Slow Roast")).toBeNull();
  });

  // The important negative: "unknown" is not "fast".
  it("excludes recipes with no stated cook time from every time bucket", async () => {
    render(<Catalog />);
    await screen.findByText("Mystery Stew");

    fireEvent.click(screen.getByRole("button", { name: /under 1 hour/i }));
    expect(screen.queryByText("Mystery Stew")).toBeNull();
    expect(screen.getByText("Quick Salad")).toBeTruthy();
  });

  it("toggles a time chip back off", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    const chip = screen.getByRole("button", { name: /under 15 min/i });
    fireEvent.click(chip);
    expect(screen.queryByText("Slow Roast")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("Slow Roast")).toBeTruthy();
  });

  it("filters by diet", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    fireEvent.click(screen.getByRole("button", { name: /^vegan$/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.queryByText("Slow Roast")).toBeNull();
    expect(screen.queryByText("Mystery Stew")).toBeNull();
  });

  it("ORs multiple diet chips together", async () => {
    render(<Catalog />);
    await screen.findByText("Slow Roast");

    fireEvent.click(screen.getByRole("button", { name: /^vegan$/i }));
    fireEvent.click(screen.getByRole("button", { name: /gluten free/i }));
    expect(screen.getByText("Quick Salad")).toBeTruthy();
    expect(screen.getByText("Slow Roast")).toBeTruthy();
    expect(screen.queryByText("Mystery Stew")).toBeNull();
  });

  it("filters by cuisine", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /italian/i }));
    expect(screen.getByText("Slow Roast")).toBeTruthy();
    expect(screen.queryByText("Quick Salad")).toBeNull();
  });

  it("ANDs different filter groups together", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    fireEvent.click(screen.getByRole("button", { name: /under 15 min/i }));
    fireEvent.click(screen.getByRole("button", { name: /gluten free/i }));
    // Nothing is both under 15 minutes AND gluten free.
    await screen.findByText(/no recipes match/i);
  });

  // Chips are built from the loaded data, so we never offer one that matches
  // nothing — and a cuisine nobody in the catalog uses gets no chip at all.
  it("only offers chips the catalog can satisfy", async () => {
    render(<Catalog />);
    await screen.findByText("Quick Salad");

    expect(screen.queryByRole("button", { name: /^thai$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pescatarian/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^vegan$/i })).toBeTruthy();
  });
});
