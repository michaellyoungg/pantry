import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Preferences } from "./Preferences";

const addAvoidItems = vi.fn();
const removeAvoidItem = vi.fn();

// Mutable so individual tests can simulate the query still being in flight
// (convex/react's useQuery returns `undefined` until it resolves).
const DEFAULT_PREFS = {
  avoidItems: ["peanut"],
  avoidResolutions: [
    {
      canonicalItem: "peanut",
      input: "peanuts",
      display: "Peanuts",
      kind: "allergen" as const,
      members: ["Peanut butter", "Peanuts"],
    },
  ],
  likedItems: [],
  dislikedItems: [],
  dietLabels: [],
};
let queryResult: unknown = DEFAULT_PREFS;

vi.mock("convex/react", () => ({
  useQuery: () => queryResult,
  useMutation: () => removeAvoidItem,
  useAction: () => addAvoidItems,
}));

vi.mock("@pantry/convex/api", () => ({
  api: {
    preferences: {
      get: "get",
      set: "set",
      addAvoidItems: "addAvoidItems",
      removeAvoidItem: "removeAvoidItem",
    },
  },
}));

beforeEach(() => {
  queryResult = DEFAULT_PREFS;
  addAvoidItems.mockReset();
  addAvoidItems.mockResolvedValue([]);
  removeAvoidItem.mockReset();
  removeAvoidItem.mockResolvedValue(undefined);
});

describe("Preferences", () => {
  it("shows the current avoid list by its resolved display name", () => {
    render(<Preferences />);
    // getByText throws if the element is absent, so a truthy assertion is
    // sufficient (this project's vitest setup does not load jest-dom matchers).
    expect(screen.getByText("Peanuts")).toBeTruthy();
  });

  // The entry is sent as typed: canonicalization happens server-side, against
  // the dictionary, which the browser has no copy of.
  it("sends what was typed to be canonicalized rather than storing it raw", async () => {
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "Scallion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addAvoidItems).toHaveBeenCalledWith({ entries: ["Scallion"] }));
  });

  it("removes an ingredient by its canonical key", async () => {
    render(<Preferences />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Peanuts" }));

    await waitFor(() => expect(removeAvoidItem).toHaveBeenCalledWith({ canonicalItem: "peanut" }));
  });

  it("says when an entry matched nothing — the whole point of resolving on entry", async () => {
    addAvoidItems.mockResolvedValue([
      {
        input: "unobtainium",
        canonicalItem: "unobtainium",
        display: "unobtainium",
        kind: "unknown",
      },
    ]);
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "unobtainium" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(screen.getByText(/doesn’t match any ingredient we know/i)).toBeTruthy(),
    );
    expect(screen.getByText(/won’t remove any recipes/i)).toBeTruthy();
  });

  it("reports what an entry was resolved to when the dictionary renamed it", async () => {
    addAvoidItems.mockResolvedValue([
      { input: "Scallion", canonicalItem: "green onion", display: "Green onion", kind: "item" },
    ]);
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "Scallion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText("Green onion")).toBeTruthy());
    expect(screen.getByText(/you typed “Scallion”/)).toBeTruthy();
  });

  it("names the members an allergen family excludes", async () => {
    addAvoidItems.mockResolvedValue([
      {
        input: "peanut",
        canonicalItem: "peanut",
        display: "Peanuts",
        kind: "allergen",
        members: ["Peanut butter", "Peanuts"],
      },
    ]);
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "peanut" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText(/also removes recipes with/i)).toBeTruthy());
    expect(screen.getByText(/Peanut butter/)).toBeTruthy();
  });

  it("offers the family when a specific member was added", async () => {
    addAvoidItems.mockResolvedValue([
      {
        input: "peanut butter",
        canonicalItem: "peanut butter",
        display: "Peanut butter",
        kind: "item",
        families: ["peanut"],
      },
    ]);
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "peanut butter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const widen = await screen.findByRole("button", { name: /avoid all peanut/i });
    addAvoidItems.mockResolvedValue([]);
    fireEvent.click(widen);

    await waitFor(() => expect(addAvoidItems).toHaveBeenCalledWith({ entries: ["peanut"] }));
  });

  it("stays quiet about entries that resolved to exactly what was typed", async () => {
    addAvoidItems.mockResolvedValue([
      { input: "tomato", canonicalItem: "tomato", display: "tomato", kind: "item" },
    ]);
    render(<Preferences />);

    fireEvent.change(screen.getByPlaceholderText("Ingredient to avoid"), {
      target: { value: "tomato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addAvoidItems).toHaveBeenCalled());
    expect(screen.queryByText(/Avoiding/)).toBeNull();
  });

  it("explains that avoided ingredients are removed, not down-ranked", () => {
    render(<Preferences />);
    expect(screen.getByText(/removed/i)).toBeTruthy();
    // The copy has to state what the matching actually does now: entries are
    // canonicalized, and allergen families cover their group. It must not go
    // back to promising more than the filter delivers, nor keep the old caveat
    // that related products need their own entry — that is no longer true.
    expect(screen.getByText(/scallion/i)).toBeTruthy();
    expect(screen.getByText(/allergens/i)).toBeTruthy();
  });

  it("sends a diet seed list through the same resolver", async () => {
    render(<Preferences />);

    fireEvent.click(screen.getByRole("button", { name: "vegetarian" }));

    await waitFor(() => expect(addAvoidItems).toHaveBeenCalled());
    const { entries } = addAvoidItems.mock.calls[0][0] as { entries: string[] };
    expect(entries).toContain("chicken");
    expect(entries).toContain("salmon");
  });

  // Regression: the Add/diet buttons were enabled while useQuery still
  // returned undefined, so they acted on the `[]` fallback rather than on the
  // stored list.
  it("disables the write controls while preferences are still loading", () => {
    queryResult = undefined;
    render(<Preferences />);
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "vegetarian" })).toHaveProperty("disabled", true);
  });

  // An entry stored before resolutions existed has no resolution row. It renders
  // as the bare key it is, claiming nothing about what it matches.
  it("renders a legacy entry with no resolution as its stored key", () => {
    queryResult = { ...DEFAULT_PREFS, avoidItems: ["shellfish"], avoidResolutions: [] };
    render(<Preferences />);
    expect(screen.getByText("shellfish")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove shellfish" })).toBeTruthy();
  });
});
