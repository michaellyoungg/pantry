import type { NutritionTarget, NutritionTargetEvaluation } from "@pantry/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoalStatus } from "./GoalStatus";

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return { nutrientId: "1003", operator: ">=", value: 150, period: "day", active: true, ...over };
}

function evaluation(over: Partial<NutritionTargetEvaluation> = {}): NutritionTargetEvaluation {
  return { target: target(), actual: 160, unit: "g", status: "met", coverage: 1, ...over };
}

const CAP = target({ nutrientId: "1253", operator: "<=", value: 200 });

describe("GoalStatus", () => {
  it("names each goal and its measured amount", () => {
    render(<GoalStatus evaluations={[evaluation()]} />);
    expect(screen.getByText(/Protein ≥ 150 g/)).toBeTruthy();
    expect(screen.getByText(/160\.0 g/)).toBeTruthy();
  });

  it("summarises how many goals were met", () => {
    // Two distinct nutrients: the store allows only one constraint per nutrient
    // per period, so two rows for the same pair is a state that cannot occur.
    render(
      <GoalStatus
        evaluations={[
          evaluation(),
          evaluation({ target: CAP, status: "under", actual: 90, unit: "mg" }),
        ]}
      />,
    );
    expect(screen.getByText(/1 of 2/)).toBeTruthy();
  });

  it("shows no number at all for an unmeasurable goal", () => {
    // The load-bearing case. A cholesterol cap on a day we could not identify
    // must not render a figure the reader would take as measured.
    const { container } = render(
      <GoalStatus
        evaluations={[
          evaluation({
            target: CAP,
            status: "unknown",
            actual: null,
            unit: "mg",
            reason: "low-coverage",
            coverage: 0.4,
          }),
        ]}
      />,
    );
    // The label may say "≤ 200 mg" — that is the goal. The measurement slot is
    // what must stay free of any figure the reader could take as what they ate.
    const detail = container.querySelector("[data-goal-detail]");
    expect(detail?.textContent).toBe("only 40% identified");
    expect(detail?.textContent).not.toMatch(/\d+\s*mg\b/);
  });

  it("reports unknowns in the summary rather than hiding them", () => {
    render(
      <GoalStatus
        evaluations={[
          evaluation(),
          evaluation({ target: CAP, status: "unknown", actual: null, reason: "low-coverage" }),
        ]}
      />,
    );
    expect(screen.getByText(/1 can't be checked|1 unknown/i)).toBeTruthy();
  });

  it("marks an exceeded cap so it is distinguishable from a missed floor", () => {
    render(
      <GoalStatus
        evaluations={[
          evaluation({ target: CAP, status: "over", actual: 260, unit: "mg" }),
          evaluation({ status: "under", actual: 90 }),
        ]}
      />,
    );
    expect(screen.getByText(/Cholesterol ≤ 200 mg/).closest("li")?.dataset.tone).toBe("bad");
    expect(screen.getByText(/Protein ≥ 150 g/).closest("li")?.dataset.tone).toBe("warn");
  });

  it("renders the empty note when there are no goals for this period", () => {
    render(<GoalStatus evaluations={[]} emptyNote="No daily goals set." />);
    expect(screen.getByText("No daily goals set.")).toBeTruthy();
  });

  it("renders nothing when there are no goals and nothing to say", () => {
    const { container } = render(<GoalStatus evaluations={[]} />);
    expect(container.textContent).toBe("");
  });
});
