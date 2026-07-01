import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Hoisted, mutable so each test can set the query result; one shared mutation spy.
const { state, mutationMock } = vi.hoisted(() => ({
  state: { lines: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.reject(new Error("toggle failed"))),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.lines,
  useMutation: () => {
    const fn = ((...args: unknown[]) => (mutationMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

import { GroceryList } from "./GroceryList";

const oneLine = [
  { _id: "g1", userId: "dev-user", item: "egg", unit: "", quantity: 1, checked: false, _creationTime: 0 },
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
    expect(alert.textContent).toContain("toggle failed");
  });

  it("clears the list via the clear mutation when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    expect(mutationMock).toHaveBeenCalledTimes(1);
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
});
