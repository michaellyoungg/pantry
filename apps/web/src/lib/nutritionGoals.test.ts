import type { NutritionTarget, NutritionTargetEvaluation } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  goalChips,
  goalLabel,
  goalSummary,
  hardConstraintCount,
  unverifiedLabel,
} from "./nutritionGoals";

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return { nutrientId: "1003", operator: ">=", value: 150, period: "day", active: true, ...over };
}

function evaluation(over: Partial<NutritionTargetEvaluation> = {}): NutritionTargetEvaluation {
  return {
    target: target(),
    actual: 160,
    unit: "g",
    status: "met",
    coverage: 1,
    ...over,
  };
}

describe("goalLabel", () => {
  it("reads a floor as a minimum", () => {
    expect(goalLabel(target({ operator: ">=", value: 150 }))).toBe("Protein ≥ 150 g");
  });

  it("reads a cap as a maximum", () => {
    expect(goalLabel(target({ nutrientId: "1253", operator: "<=", value: 200 }))).toBe(
      "Cholesterol ≤ 200 mg",
    );
  });

  it("reads an equality target as approximate, because the number is an estimate", () => {
    expect(goalLabel(target({ nutrientId: "1008", operator: "==", value: 2000 }))).toBe(
      "Calories ≈ 2000 kcal",
    );
  });

  it("falls back to the nutrient id when the catalog does not know it", () => {
    expect(goalLabel(target({ nutrientId: "9999" }))).toContain("9999");
  });

  it("prefers the user's own label when they gave one", () => {
    expect(goalLabel(target({ label: "Bulking protein" }))).toBe(
      "Bulking protein: Protein ≥ 150 g",
    );
  });
});

describe("goalChips", () => {
  it("shows the measured amount for a met goal", () => {
    const [chip] = goalChips([evaluation()]);
    expect(chip.status).toBe("met");
    expect(chip.tone).toBe("good");
    // One decimal for grams, matching the recipe nutrition panel exactly — two
    // different roundings for the same number on two screens reads as a bug.
    expect(chip.detail).toBe("160.0 g");
  });

  it("treats exceeding a cap as bad", () => {
    const [chip] = goalChips([
      evaluation({
        target: target({ nutrientId: "1253", operator: "<=", value: 200 }),
        status: "over",
        actual: 260,
        unit: "mg",
      }),
    ]);
    expect(chip.tone).toBe("bad");
  });

  it("treats falling short of a floor as a nudge, not a failure", () => {
    // Being under a protein goal on Tuesday is the normal state of affairs;
    // colouring it as an error would make the whole screen read as alarming.
    const [chip] = goalChips([evaluation({ status: "under", actual: 90 })]);
    expect(chip.tone).toBe("warn");
  });

  it("never presents an unknown as a number", () => {
    const [chip] = goalChips([
      evaluation({ status: "unknown", actual: null, reason: "low-coverage", coverage: 0.4 }),
    ]);
    expect(chip.tone).toBe("muted");
    expect(chip.detail).not.toMatch(/\d+\s*g/);
  });

  it("says how much was identified when coverage is the problem", () => {
    const [chip] = goalChips([
      evaluation({ status: "unknown", actual: null, reason: "low-coverage", coverage: 0.4 }),
    ]);
    expect(chip.detail).toContain("40%");
  });

  it("says nothing is planned when there is no estimate at all", () => {
    const [chip] = goalChips([
      evaluation({ status: "unknown", actual: null, reason: "no-estimate", coverage: null }),
    ]);
    expect(chip.detail).toMatch(/no estimate|nothing planned/i);
  });

  it("distinguishes a nutrient we could not measure from a low-coverage estimate", () => {
    const [chip] = goalChips([
      evaluation({ status: "unknown", actual: null, reason: "nutrient-missing", coverage: 1 }),
    ]);
    expect(chip.detail).toMatch(/not measured|no .* figure/i);
  });

  it("gives every chip a stable key", () => {
    const chips = goalChips([
      evaluation(),
      evaluation({ target: target({ nutrientId: "1005", operator: "<=", value: 50 }) }),
    ]);
    expect(new Set(chips.map((c) => c.key)).size).toBe(2);
  });

  it("rounds grams to a decimal and milligrams to whole numbers", () => {
    expect(goalChips([evaluation({ actual: 160.44 })])[0].detail).toBe("160.4 g");
    expect(
      goalChips([evaluation({ actual: 1594.772, unit: "mg", status: "over" })])[0].detail,
    ).toBe("1595 mg");
  });
});

describe("goalSummary", () => {
  it("counts met goals out of the ones it could judge", () => {
    const summary = goalSummary([
      evaluation({ status: "met" }),
      evaluation({ status: "met" }),
      evaluation({ status: "under" }),
    ]);
    expect(summary.met).toBe(2);
    expect(summary.judged).toBe(3);
    expect(summary.unknown).toBe(0);
  });

  it("excludes unknowns from the denominator rather than counting them as missed", () => {
    // "1 of 3" when we could only measure one of them overstates the failure;
    // the unknowns are reported separately so the user knows to look.
    const summary = goalSummary([
      evaluation({ status: "met" }),
      evaluation({ status: "unknown", actual: null, reason: "low-coverage" }),
      evaluation({ status: "unknown", actual: null, reason: "no-estimate" }),
    ]);
    expect(summary.met).toBe(1);
    expect(summary.judged).toBe(1);
    expect(summary.unknown).toBe(2);
  });

  it("is not 'on track' while anything is unknown", () => {
    // The whole point of the unknown status: silence is not a pass.
    const summary = goalSummary([
      evaluation({ status: "met" }),
      evaluation({ status: "unknown", actual: null, reason: "low-coverage" }),
    ]);
    expect(summary.onTrack).toBe(false);
  });

  it("is on track only when every goal is met", () => {
    expect(goalSummary([evaluation(), evaluation()]).onTrack).toBe(true);
    expect(goalSummary([evaluation(), evaluation({ status: "under" })]).onTrack).toBe(false);
  });

  it("reports nothing to judge when there are no goals", () => {
    const summary = goalSummary([]);
    expect(summary.judged).toBe(0);
    expect(summary.onTrack).toBe(false);
  });
});

describe("unverifiedLabel", () => {
  it("prefers the user's own name for the goal", () => {
    expect(unverifiedLabel({ nutrientId: "1253", label: "Low cholesterol" })).toBe(
      "Low cholesterol",
    );
  });

  it("falls back to the nutrient catalog", () => {
    expect(unverifiedLabel({ nutrientId: "1253" })).toBe("Cholesterol");
  });

  // Never silence: a constraint that renders as nothing reads exactly like one
  // that passed, which is the failure this whole field exists to prevent.
  it("still names a nutrient it has never heard of", () => {
    expect(unverifiedLabel({ nutrientId: "9999" })).toBe("Nutrient 9999");
  });
});

describe("hardConstraintCount", () => {
  it("counts only goals the user marked as required", () => {
    expect(hardConstraintCount([target(), target({ hard: true })])).toBe(1);
  });

  // The operator does not decide this. A cap is not automatically a constraint.
  it("does not treat a cap as a constraint on its own", () => {
    expect(hardConstraintCount([target({ operator: "<=", nutrientId: "1253" })])).toBe(0);
  });

  it("ignores paused goals, which filter nothing", () => {
    expect(hardConstraintCount([target({ hard: true, active: false })])).toBe(0);
  });
});
