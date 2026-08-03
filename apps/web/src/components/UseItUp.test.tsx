import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PantryRow } from "../lib/expiry";

const DAY = 86_400_000;

const state = vi.hoisted(() => ({
  pantry: [] as unknown[],
  recipesToUse: vi.fn(async (_args: { items: string[] }) => [] as unknown[]),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.pantry,
  useAction: () => state.recipesToUse,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

const { UseItUp } = await import("./UseItUp");

function row(over: Partial<PantryRow> = {}): PantryRow {
  return {
    _id: `p${over.canonicalItem ?? "x"}`,
    display: "Spinach",
    canonicalItem: "spinach",
    state: "have",
    useBy: Date.now() + 2 * DAY,
    ...over,
  };
}

describe("UseItUp", () => {
  beforeEach(() => {
    state.pantry = [];
    state.recipesToUse = vi.fn(async () => []);
  });

  it("renders nothing when nothing is expiring — no zero badge, no empty state", () => {
    state.pantry = [row({ useBy: Date.now() + 60 * DAY })];
    const { container } = render(<UseItUp />);
    expect(container.innerHTML).toBe("");
  });

  it("batches expiring items into a single prompt rather than per-item badges", async () => {
    state.pantry = [
      row({ canonicalItem: "spinach", display: "Spinach", useBy: Date.now() + 2 * DAY }),
      row({ canonicalItem: "milk", display: "Milk", useBy: Date.now() + 4 * DAY }),
      row({ canonicalItem: "bread", display: "Bread", useBy: Date.now() - DAY }),
    ];
    render(<UseItUp />);

    expect(await screen.findByText(/3 items to use this week/i)).toBeTruthy();
    expect(screen.getByText(/Spinach/)).toBeTruthy();
    expect(screen.getByText(/Milk/)).toBeTruthy();
  });

  it("says the dates are estimates", () => {
    state.pantry = [row()];
    render(<UseItUp />);
    expect(screen.getByText(/estimate/i)).toBeTruthy();
  });

  it("uses singular wording for one item", () => {
    state.pantry = [row()];
    render(<UseItUp />);
    expect(screen.getByText(/1 item to use this week/i)).toBeTruthy();
  });

  it("asks for recipes that use exactly the expiring items", async () => {
    state.pantry = [
      row({ canonicalItem: "spinach", useBy: Date.now() + DAY }),
      row({ canonicalItem: "rice", useBy: Date.now() + 400 * DAY }),
    ];
    render(<UseItUp />);

    await waitFor(() => expect(state.recipesToUse).toHaveBeenCalled());
    expect(state.recipesToUse.mock.calls[0][0]).toEqual({ items: ["spinach"] });
  });

  it("offers the recipes it finds as the action", async () => {
    state.pantry = [row()];
    state.recipesToUse = vi.fn(async () => [
      { id: "r1", title: "Creamed Spinach", matchedItems: ["spinach"] },
    ]);
    render(<UseItUp />);

    expect(await screen.findByText("Creamed Spinach")).toBeTruthy();
  });

  it("stays quiet when no recipe matches instead of showing a dead link", async () => {
    state.pantry = [row()];
    render(<UseItUp />);

    await waitFor(() => expect(state.recipesToUse).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: /recipes/i })).toBeNull();
    expect(await screen.findByText(/no recipe/i)).toBeTruthy();
  });
});
