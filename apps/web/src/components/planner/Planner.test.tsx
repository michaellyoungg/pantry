import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { entries: [] as Array<Record<string, unknown>> } }));

vi.mock("convex/react", () => ({
  useQuery: () => state.entries,
  useMutation: () => {
    const fn = ((..._a: unknown[]) => Promise.resolve()) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
  useAction: () => () => Promise.resolve({ count: 0 }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { Planner } from "./Planner";

beforeEach(() => {
  state.entries = [];
});
afterEach(() => vi.restoreAllMocks());

describe("Planner", () => {
  it("buckets a meal under its planned day within the visible week", () => {
    state.entries = [
      {
        _id: "e1",
        recipeId: "r1",
        title: "Tacos",
        plannedDate: "2026-07-14",
        servingsMultiplier: 1,
        type: "meal",
      },
    ];
    render(<Planner initialToday="2026-07-15" />);
    const tuesday = screen.getByTestId("day-2026-07-14");
    expect(within(tuesday).getByText("Tacos")).toBeTruthy();
  });

  it("shows unscheduled entries in the tray", () => {
    state.entries = [
      { _id: "e2", recipeId: "r2", title: "Soup", servingsMultiplier: 1, type: "meal" },
    ];
    render(<Planner initialToday="2026-07-15" />);
    const tray = screen.getByTestId("unscheduled-tray");
    expect(within(tray).getByText("Soup")).toBeTruthy();
  });

  it("renders the week label", () => {
    render(<Planner initialToday="2026-07-15" />);
    expect(screen.getByText(/Jul 12 – 18/)).toBeTruthy();
  });
});
