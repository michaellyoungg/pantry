import { type PlanNutrition, planGoalStatus } from "@pantry/core";
import type { NutritionEstimate, NutritionTarget } from "@pantry/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanGoals } from "./PlanGoals";

/**
 * The evaluation is `planGoalStatus` in `@pantry/core`, tested there without a
 * DOM. These render its real output rather than a hand-built prop, so the
 * assertions still read "this week, these goals, these chips".
 */

const dayCap: NutritionTarget = {
  nutrientId: "1253",
  operator: "<=",
  value: 200,
  period: "day",
  active: true,
};

const weekFloor: NutritionTarget = {
  ...dayCap,
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

function goalsFor(targets: NutritionTarget[], data: PlanNutrition) {
  const goals = planGoalStatus(targets, data);
  return { goals, ...render(goals === null ? <></> : <PlanGoals goals={goals} />) };
}

/** The chip whose label matches, as the `<li>` carrying its status. */
function chip(pattern: RegExp): HTMLElement | null {
  return screen.getByText(pattern).closest("li");
}

describe("PlanGoals", () => {
  it("has nothing to draw when the user has no day or week goals", () => {
    const { goals, container } = goalsFor([{ ...dayCap, period: "meal" }], {
      days: [{ weekday: 0, estimate: estimate(50) }],
      week: null,
    });

    expect(goals).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("names the day a goal was judged against", () => {
    goalsFor([dayCap], { days: [{ weekday: 2, estimate: estimate(50) }], week: null });

    expect(screen.getByText("Wednesday")).toBeTruthy();
  });

  it("judges each planned day separately", () => {
    goalsFor([dayCap], {
      days: [
        { weekday: 0, estimate: estimate(50) },
        { weekday: 1, estimate: estimate(400) },
      ],
      week: null,
    });

    const monday = screen.getByText("Monday").closest("li") as HTMLElement;
    const tuesday = screen.getByText("Tuesday").closest("li") as HTMLElement;
    expect(
      within(monday)
        .getByText(/Cholesterol/)
        .closest("li")?.dataset.status,
    ).toBe("met");
    expect(
      within(tuesday)
        .getByText(/Cholesterol/)
        .closest("li")?.dataset.status,
    ).toBe("over");
  });

  it("judges week goals against the week estimate, not a day", () => {
    goalsFor([weekFloor], { days: [], week: estimate(100) });

    expect(chip(/Protein ≥ 700 g/)?.dataset.status).toBe("met");
  });

  // This is the case the coordination with the rollup exists for: a day holding
  // a recipe we could not read must not report a clean cholesterol day. Zero
  // food identified is not zero cholesterol eaten.
  it("reports a day it could not account for as unknown, never as under the limit", () => {
    goalsFor([dayCap], {
      days: [
        {
          weekday: 0,
          estimate: estimate(10, {
            coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 6 },
          }),
        },
      ],
      week: null,
    });

    expect(chip(/Cholesterol ≤ 200 mg/)?.dataset.status).toBe("unknown");
    expect(chip(/Cholesterol ≤ 200 mg/)?.dataset.tone).toBe("muted");
  });

  it("says the week is unknown when the rollup has no week estimate", () => {
    goalsFor([weekFloor], { days: [], week: null });

    expect(chip(/Protein ≥ 700 g/)?.dataset.status).toBe("unknown");
  });

  it("only shows days the plan actually has food on", () => {
    goalsFor([dayCap], { days: [{ weekday: 0, estimate: estimate(50) }], week: null });

    expect(screen.queryByText("Sunday")).toBeNull();
  });

  it("does not show a day section when there are only week goals", () => {
    goalsFor([weekFloor], {
      days: [{ weekday: 0, estimate: estimate(50) }],
      week: estimate(50),
    });

    expect(screen.queryByText("Monday")).toBeNull();
  });
});
