import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted, mutable so each test seeds the basket query. One shared mutation spy
// (mirrors GroceryList.test); tests distinguish which mutation fired by the
// args it was called with — schedule carries a `weekday`, unschedule does not.
const { state, mutationMock, actionMock } = vi.hoisted(() => ({
  state: { items: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.resolve()),
  actionMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.items,
  useAction: () => actionMock,
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

// The nutrition rollup (BL-0037) is a Convex action of its own and has its own
// test; stubbed here so its load doesn't land on this file's shared action spy.
vi.mock("./PlanNutrition", () => ({ PlanNutrition: () => null }));

import { WeekPlan } from "./WeekPlan";

const row = (over: Record<string, unknown>) => ({
  _id: "b1",
  userId: "user-a",
  recipeId: "r1",
  title: "Toast",
  _creationTime: 0,
  ...over,
});

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

beforeEach(() => {
  vi.clearAllMocks();
  state.items = [];
});
afterEach(() => vi.restoreAllMocks());

describe("WeekPlan", () => {
  it("renders all seven days", () => {
    render(<WeekPlan />);
    for (const day of ALL_DAYS) expect(screen.getByText(day)).toBeTruthy();
  });

  it("shows an unscheduled recipe in the rail and schedules it on the picked day", () => {
    state.items = [row({ recipeId: "r1", title: "Toast" })]; // no weekday => unscheduled
    render(<WeekPlan />);

    expect(screen.getByText("Not yet planned")).toBeTruthy();
    // Pick Wednesday (index 2) from that row's day picker.
    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));

    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1", weekday: 2 });
  });

  it("renders a scheduled recipe under its day and unschedules it on ×", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0 })]; // Monday
    render(<WeekPlan />);

    expect(screen.getByText("Toast")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Toast from Monday" }));

    // unschedule is called with just the recipe id (no weekday).
    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1" });
  });

  it("generate is disabled with an empty basket and calls the action otherwise", () => {
    const { rerender } = render(<WeekPlan />);
    const btn = () =>
      screen.getByRole("button", { name: /Generate grocery list/ }) as HTMLButtonElement;
    expect(btn().disabled).toBe(true);

    state.items = [row({ recipeId: "r1", weekday: 1 })];
    rerender(<WeekPlan />);
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    expect(actionMock).toHaveBeenCalledTimes(1);
  });
});

describe("WeekPlan servings & leftovers (increment 2)", () => {
  it("increases servings on a scheduled meal", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0 })];
    render(<WeekPlan />);
    fireEvent.click(screen.getByRole("button", { name: /increase servings for Toast/i }));
    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1", servingsMultiplier: 1.5 });
  });

  it("does not decrease servings below 0.25", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0, servingsMultiplier: 0.25 })];
    render(<WeekPlan />);
    fireEvent.click(screen.getByRole("button", { name: /decrease servings for Toast/i }));
    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1", servingsMultiplier: 0.25 });
  });

  it("marks a scheduled meal as leftover", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0 })];
    render(<WeekPlan />);
    fireEvent.click(screen.getByRole("button", { name: /mark Toast as leftover/i }));
    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1", type: "leftover" });
  });
});

// The "cooked" affordance (BL-0028) — the planner end of the pantry's outflow
// signal. The mutation mock is shared and markCooked/unmarkCooked take identical
// args, so these tests pin what the UI offers and that it fires; which of the two
// runs is a one-line ternary, and the semantics are covered in basket.test.ts.
describe("WeekPlan cooked affordance (BL-0028)", () => {
  it("offers to mark a scheduled meal cooked and fires the mutation", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0 })];
    render(<WeekPlan />);

    const btn = screen.getByRole("button", { name: "Mark Toast as cooked" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);

    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1" });
  });

  it("shows a cooked meal as done and offers to undo it", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0, cookedAt: 1 })];
    render(<WeekPlan />);

    const btn = screen.getByRole("button", { name: "Mark Toast as not cooked" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);

    expect(mutationMock).toHaveBeenCalledWith({ recipeId: "r1" });
  });

  it("calls it 'eaten' for a leftover, which consumes nothing new", () => {
    state.items = [row({ recipeId: "r1", title: "Toast", weekday: 0, type: "leftover" })];
    render(<WeekPlan />);

    expect(screen.getByRole("button", { name: "Mark Toast as eaten" })).toBeTruthy();
  });
});
