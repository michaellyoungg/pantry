import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted, mutable so each test can set the query result; one shared mutation spy.
const { state, mutationMock } = vi.hoisted(() => ({
  state: { lines: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.reject(new Error("mutation failed"))),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.lines,
  useMutation: () => {
    const fn = ((...args: unknown[]) =>
      (mutationMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

import { GroceryList } from "./GroceryList";

const oneLine = [
  {
    _id: "g1",
    userId: "dev-user",
    item: "egg",
    unit: "",
    quantity: 1,
    aisle: "other",
    checked: false,
    _creationTime: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.lines = oneLine;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroceryList", () => {
  it("surfaces an inline error when toggling fails", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mutation failed");
  });

  it("clears the list via the clear mutation when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(mutationMock).toHaveBeenCalledWith({}); // the clear mutation, args {}
    // the shared mock rejects → let the run() settle so no act warning
    await screen.findByRole("alert");
  });

  it("does not clear when confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("hides the Clear list button when the list is empty", () => {
    state.lines = [];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /clear list/i })).toBeNull();
  });

  it("renders aisle section headers and groups lines under them", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
      {
        _id: "b",
        userId: "dev-user",
        item: "Sriracha",
        unit: "tbsp",
        quantity: 2,
        aisle: "other",
        checked: false,
        _creationTime: 1,
      },
    ];
    render(<GroceryList />);
    expect(screen.getByText("Dairy")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("renders quantities as fraction glyphs", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Butter",
        unit: "cup",
        quantity: 0.75,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
    ];
    render(<GroceryList />);
    expect(screen.getByText(/¾ cup Butter/)).toBeTruthy();
  });

  it("groups consecutive same-aisle lines under a single header", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
      {
        _id: "b",
        userId: "dev-user",
        item: "Butter",
        unit: "cup",
        quantity: 0.5,
        aisle: "dairy",
        checked: false,
        _creationTime: 1,
      },
    ];
    render(<GroceryList />);
    expect(screen.getAllByText("Dairy")).toHaveLength(1);
    expect(screen.getByText(/Milk/)).toBeTruthy();
    expect(screen.getByText(/Butter/)).toBeTruthy();
  });

  it("moves checked items into a collapsible In cart section", () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: false,
        _creationTime: 0,
      },
      {
        _id: "b",
        userId: "dev-user",
        item: "Bread",
        unit: "loaf",
        quantity: 1,
        aisle: "bakery",
        checked: true,
        _creationTime: 1,
      },
    ];
    render(<GroceryList />);
    // Unchecked item stays in its aisle; checked item leaves the to-buy sections.
    expect(screen.getByText("Dairy")).toBeTruthy();
    expect(screen.getByText(/Milk/)).toBeTruthy();
    expect(screen.queryByText("Bakery")).toBeNull();
    // Checked item is tucked into a collapsed "In cart" drawer until expanded.
    expect(screen.getByText("In cart")).toBeTruthy();
    expect(screen.queryByText(/Bread/)).toBeNull();
    fireEvent.click(screen.getByText("In cart"));
    expect(screen.getByText(/Bread/)).toBeTruthy();
  });

  it("collapses an aisle section when its header is tapped", () => {
    render(<GroceryList />); // oneLine: a single unchecked "egg" in aisle "other"
    expect(screen.getByText(/egg/)).toBeTruthy();
    fireEvent.click(screen.getByText("Other"));
    expect(screen.queryByText(/egg/)).toBeNull();
  });

  it("removes purchased items through the Done shopping flow", async () => {
    state.lines = [
      {
        _id: "a",
        userId: "dev-user",
        item: "Milk",
        unit: "cup",
        quantity: 1,
        aisle: "dairy",
        checked: true,
        _creationTime: 0,
      },
    ];
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /done shopping/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove purchased/i }));
    expect(mutationMock).toHaveBeenCalledWith({});
    // shared mock rejects → let run() settle so no act warning
    await screen.findByRole("alert");
  });
});
