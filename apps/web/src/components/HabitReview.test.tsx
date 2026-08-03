import type { NutritionLogEntry, NutritionLogSource } from "@pantry/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock, queryMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useQuery: (_ref: unknown, args: unknown) => queryMock(args),
}));

import { HabitReview } from "./HabitReview";

const ENERGY = "1008";
const PROTEIN = "1003";
const TODAY = "2026-08-09"; // a Sunday; the week starts Mon 2026-08-03

function entry(over: {
  date: string;
  kcal?: number;
  protein?: number;
  servings?: number;
  coverage?: number;
  source?: NutritionLogSource;
  recipeId?: string;
}): NutritionLogEntry {
  const nutrients: NutritionLogEntry["snapshot"]["nutrients"] = {};
  if (over.kcal !== undefined) {
    nutrients[ENERGY] = { nutrientId: ENERGY, amount: over.kcal, unit: "kcal" };
  }
  if (over.protein !== undefined) {
    nutrients[PROTEIN] = { nutrientId: PROTEIN, amount: over.protein, unit: "g" };
  }
  return {
    date: over.date,
    recipeId: over.recipeId ?? "r1",
    title: "Chilli",
    servings: over.servings ?? 1,
    source: over.source ?? "planned",
    snapshot: {
      nutrients,
      coverage: {
        resolvedMassFraction: over.coverage ?? 1,
        resolvedCount: 4,
        totalCount: 4,
      },
      estimatedAt: "2026-08-03T12:00:00Z",
    },
  };
}

describe("HabitReview", () => {
  beforeEach(() => {
    actionMock.mockReset();
    queryMock.mockReset();
    queryMock.mockReturnValue([]);
  });

  it("waits for the log rather than rendering an empty history", () => {
    queryMock.mockReturnValue(undefined);
    render(<HabitReview today={TODAY} />);
    expect(screen.getByText(/Loading your history/)).toBeTruthy();
  });

  it("states that the numbers come from the plan, and that a plan is not a meal", () => {
    queryMock.mockReturnValue([entry({ date: "2026-08-05", kcal: 800, source: "planned" })]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("Based on your plan")).toBeTruthy();
    expect(screen.getByText(/not confirmation you cooked them/)).toBeTruthy();
  });

  it("says 'what you cooked' once cooked rows exist, with no caveat", () => {
    queryMock.mockReturnValue([entry({ date: "2026-08-05", kcal: 800, source: "cooked" })]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("Based on what you cooked")).toBeTruthy();
    expect(screen.queryByText(/not confirmation you cooked them/)).toBeNull();
  });

  it("averages over counted days only, not the whole window", () => {
    // Two 1000 kcal days in a 7-day window: the average is 1000, not 285.
    queryMock.mockReturnValue([
      entry({ date: "2026-08-05", kcal: 1000 }),
      entry({ date: "2026-08-06", kcal: 1000, recipeId: "r2" }),
    ]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("1000 kcal")).toBeTruthy();
    expect(screen.getByText(/2 of 7 days counted/)).toBeTruthy();
  });

  it("names the excluded days and why, instead of burying them", () => {
    queryMock.mockReturnValue([
      entry({ date: "2026-08-05", kcal: 1000 }),
      entry({ date: "2026-08-06", kcal: 900, coverage: 0.2, recipeId: "r2" }),
    ]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("Days not counted")).toBeTruthy();
    expect(screen.getByText(/nothing logged · 5/)).toBeTruthy();
    expect(screen.getByText(/too little of the meal identified · 1/)).toBeTruthy();
    expect(screen.getByText(/rather than counted as zero/)).toBeTruthy();
  });

  it("shows no average at all when no day could be counted", () => {
    queryMock.mockReturnValue([entry({ date: "2026-08-05", kcal: 1000, coverage: 0.1 })]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getAllByText(/no average to show/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 kcal/)).toBeNull();
  });

  it("suppresses one nutrient without suppressing the others", () => {
    // Energy is on both meals; protein is on only one, so the protein total for
    // that day would silently omit a dinner.
    queryMock.mockReturnValue([
      entry({ date: "2026-08-05", kcal: 600, protein: 40 }),
      entry({ date: "2026-08-05", kcal: 400, recipeId: "r2" }),
    ]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("1000 kcal")).toBeTruthy();
    const protein = screen.getByText("Protein").closest("section");
    expect(protein?.textContent).toMatch(/no average to show/);
  });

  it("prompts for a first record when nothing is logged", () => {
    queryMock.mockReturnValue([]);
    render(<HabitReview today={TODAY} />);

    expect(screen.getByText("Nothing logged yet")).toBeTruthy();
    expect(screen.getByText(/No meals recorded in this window yet/)).toBeTruthy();
  });

  it("records the plan for the week containing today, not an arbitrary 7 days", async () => {
    actionMock.mockResolvedValue({ written: 3, removed: 0, preserved: 0, skipped: [] });
    render(<HabitReview today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Record this week's plan" }));

    await waitFor(() => {
      // 2026-08-09 is a Sunday; its week begins Monday 2026-08-03.
      expect(actionMock).toHaveBeenCalledWith({ weekStart: "2026-08-03" });
    });
  });

  it("surfaces a failed recording instead of silently doing nothing", async () => {
    actionMock.mockRejectedValue(new Error("recipe-service unreachable"));
    render(<HabitReview today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Record this week's plan" }));

    expect(await screen.findByText(/recipe-service unreachable/)).toBeTruthy();
  });

  it("re-queries a wider window when one is chosen", () => {
    render(<HabitReview today={TODAY} />);
    expect(queryMock).toHaveBeenCalledWith({ from: "2026-08-03", to: TODAY });

    fireEvent.click(screen.getByText("30 days"));

    expect(queryMock).toHaveBeenCalledWith({ from: "2026-07-11", to: TODAY });
  });
});
