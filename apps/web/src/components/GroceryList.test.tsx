import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Hoisted so the vi.mock factory can reference it.
const { rejectingToggle } = vi.hoisted(() => {
  const fn = vi.fn(() => Promise.reject(new Error("toggle failed"))) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: ReturnType<typeof vi.fn>;
  };
  fn.withOptimisticUpdate = vi.fn(() => fn);
  return { rejectingToggle: fn };
});

vi.mock("convex/react", () => ({
  useQuery: () => [
    { _id: "g1", userId: "dev-user", item: "egg", unit: "", quantity: 1, checked: false, _creationTime: 0 },
  ],
  useMutation: () => rejectingToggle,
}));

import { GroceryList } from "./GroceryList";

describe("GroceryList", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("surfaces an inline error when toggling fails", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("toggle failed");
  });
});
