import type { NutritionEstimate } from "@pantry/types";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { rows: [] as Array<Record<string, unknown>> } }));

vi.mock("convex/react", () => ({ useQuery: () => state.rows }));
vi.mock("@pantry/convex/api", () => ({
  api: { nutritionTargets: { list: "nutritionTargets:list" } },
}));

import { PlanGoals } from "./PlanGoals";

const dayCap = {
  _id: "t1",
  _creationTime: 0,
  userId: "u",
  nutrientId: "1253",
  operator: "<=",
  value: 200,
  period: "day",
  active: true,
};

const weekFloor = {
  ...dayCap,
  _id: "t2",
  nutrientId: "1003",
  operator: ">=",
  value: 700,
  period: "week",
};

function estimate(cholesterol: number, over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1253": { nutrientId: "1253", amount: cholesterol, unit: "mg" },
      "1003": { nutrientId: "1003", amount: 800, unit: "g" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 6, totalCount: 6 },
    ingredients: [],
    estimatedAt: "2026-08-03T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  state.rows = [];
});
afterEach(() => vi.restoreAllMocks());

describe("PlanGoals", () => {
  it("renders nothing when the user has no day or week goals", () => {
    state.rows = [{ ...dayCap, period: "meal" }];
    const { container } = render(
      <PlanGoals days={[{ weekday: 0, estimate: estimate(50) }]} week={null} />,
    );
    expect(container.textContent).toBe("");
  });

  it("names the day a goal was judged against", () => {
    state.rows = [dayCap];
    render(<PlanGoals days={[{ weekday: 2, estimate: estimate(50) }]} week={null} />);
    expect(screen.getByText("Wednesday")).toBeTruthy();
  });

  it("judges each planned day separately", () => {
    state.rows = [dayCap];
    render(
      <PlanGoals
        days={[
          { weekday: 0, estimate: estimate(50) },
          { weekday: 1, estimate: estimate(400) },
        ]}
        week={null}
      />,
    );
    const monday = screen.getByText("Monday").closest("li");
    const tuesday = screen.getByText("Tuesday").closest("li");
    expect(
      within(monday as HTMLElement)
        .getByText(/Cholesterol/)
        .closest("li")?.dataset.status,
    ).toBe("met");
    expect(
      within(tuesday as HTMLElement)
        .getByText(/Cholesterol/)
        .closest("li")?.dataset.status,
    ).toBe("over");
  });

  it("judges week goals against the week estimate, not a day", () => {
    state.rows = [weekFloor];
    render(<PlanGoals days={[]} week={estimate(100)} />);
    expect(screen.getByText(/Protein ≥ 700 g/)).toBeTruthy();
    expect(screen.getByText(/Protein ≥ 700 g/).closest("li")?.dataset.status).toBe("met");
  });

  it("reports a day it could not account for as unknown, never as under the limit", () => {
    // This is the case the coordination with the rollup exists for: a day
    // holding a recipe we could not read must not report a clean cholesterol
    // day. Zero food identified is not zero cholesterol eaten.
    state.rows = [dayCap];
    const thin = estimate(10, {
      coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 6 },
    });
    render(<PlanGoals days={[{ weekday: 0, estimate: thin }]} week={null} />);
    const chip = screen.getByText(/Cholesterol ≤ 200 mg/).closest("li");
    expect(chip?.dataset.status).toBe("unknown");
    expect(chip?.dataset.tone).toBe("muted");
  });

  it("says the week is unknown when the rollup has no week estimate", () => {
    state.rows = [weekFloor];
    render(<PlanGoals days={[]} week={null} />);
    expect(screen.getByText(/Protein ≥ 700 g/).closest("li")?.dataset.status).toBe("unknown");
  });

  it("only shows days the plan actually has food on", () => {
    state.rows = [dayCap];
    render(<PlanGoals days={[{ weekday: 0, estimate: estimate(50) }]} week={null} />);
    expect(screen.queryByText("Sunday")).toBeNull();
  });

  it("does not show a day section when there are only week goals", () => {
    state.rows = [weekFloor];
    render(<PlanGoals days={[{ weekday: 0, estimate: estimate(50) }]} week={estimate(50)} />);
    expect(screen.queryByText("Monday")).toBeNull();
  });
});
