import type { NutritionLogEntry, NutritionLogSource, NutritionTarget } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  exclusionLabel,
  goalMetRates,
  habitReview,
  habitSignal,
  MIN_DAY_COVERAGE,
  type NutrientTrend,
} from "./nutritionHistory";

const ENERGY = "1008";
const PROTEIN = "1003";

function entry(over: {
  date: string;
  kcal?: number;
  protein?: number;
  servings?: number;
  coverage?: number;
  source?: NutritionLogSource;
  recipeId?: string;
  totalCount?: number;
}): NutritionLogEntry {
  const nutrients: NutritionLogEntry["snapshot"]["nutrients"] = {};
  if (over.kcal !== undefined) {
    nutrients[ENERGY] = { nutrientId: ENERGY, amount: over.kcal, unit: "kcal" };
  }
  if (over.protein !== undefined) {
    nutrients[PROTEIN] = { nutrientId: PROTEIN, amount: over.protein, unit: "g" };
  }
  const totalCount = over.totalCount ?? 4;
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
        resolvedCount: totalCount,
        totalCount,
      },
      estimatedAt: "2026-08-03T12:00:00Z",
    },
  };
}

const WEEK = { from: "2026-08-03", to: "2026-08-09" };

function trend(review: { trends: NutrientTrend[] }, nutrientId: string): NutrientTrend {
  const found = review.trends.find((t) => t.nutrientId === nutrientId);
  if (!found) throw new Error(`no trend for ${nutrientId}`);
  return found;
}

describe("habitReview — window", () => {
  it("emits one day per calendar day in the window, ascending", () => {
    const review = habitReview([], { window: WEEK, nutrientIds: [ENERGY] });
    expect(review.days.map((d) => d.date)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("ignores entries outside the window", () => {
    const review = habitReview([entry({ date: "2026-07-30", kcal: 900 })], {
      window: WEEK,
      nutrientIds: [ENERGY],
    });
    expect(review.loggedMeals).toBe(0);
    expect(review.days.every((d) => d.entryCount === 0)).toBe(true);
  });
});

describe("habitReview — days are excluded, never counted as zero", () => {
  it("excludes a day with nothing logged", () => {
    const review = habitReview([entry({ date: "2026-08-03", kcal: 800 })], {
      window: WEEK,
      nutrientIds: [ENERGY],
    });

    const empty = review.days.filter((d) => !d.included);
    expect(empty).toHaveLength(6);
    expect(empty.every((d) => d.reason === "no-entries")).toBe(true);
    expect(review.includedDays).toBe(1);
    expect(review.excludedDays).toBe(6);
  });

  it("does not drag the average down with unlogged days", () => {
    // One 800 kcal day in a seven-day window averages 800 — not 800/7 = 114.
    const review = habitReview([entry({ date: "2026-08-03", kcal: 800 })], {
      window: WEEK,
      nutrientIds: [ENERGY],
    });
    expect(trend(review, ENERGY).average).toBe(800);
  });

  it("reports null rather than 0 when no day qualifies", () => {
    const review = habitReview([], { window: WEEK, nutrientIds: [ENERGY] });
    const energy = trend(review, ENERGY);
    expect(energy.average).toBeNull();
    expect(energy.total).toBeNull();
    expect(energy.points.every((p) => p.value === null)).toBe(true);
  });

  it("excludes a day whose meal fell below the coverage floor", () => {
    const review = habitReview(
      [
        entry({ date: "2026-08-03", kcal: 800, coverage: 0.4 }),
        entry({ date: "2026-08-04", kcal: 700, coverage: 1 }),
      ],
      { window: WEEK, nutrientIds: [ENERGY] },
    );

    const [first, second] = review.days;
    expect(first).toMatchObject({ included: false, reason: "low-coverage", minCoverage: 0.4 });
    expect(second.included).toBe(true);
    expect(trend(review, ENERGY).average).toBe(700);
  });

  it("lets the weakest meal decide the day", () => {
    // A well-covered lunch does not rescue a dinner we could not identify: the
    // day's total is an undercount of unknown size either way.
    const review = habitReview(
      [
        entry({ date: "2026-08-03", kcal: 500, coverage: 1 }),
        entry({ date: "2026-08-03", kcal: 900, coverage: 0.3, recipeId: "r2" }),
      ],
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(review.days[0]).toMatchObject({ included: false, reason: "low-coverage" });
  });

  it("treats a recipe with no ingredient lines as uncovered", () => {
    const review = habitReview([entry({ date: "2026-08-03", kcal: 0, totalCount: 0 })], {
      window: WEEK,
      nutrientIds: [ENERGY],
    });
    expect(review.days[0]).toMatchObject({ included: false, reason: "low-coverage" });
  });

  it("includes a day exactly at the coverage floor", () => {
    const review = habitReview(
      [entry({ date: "2026-08-03", kcal: 800, coverage: MIN_DAY_COVERAGE })],
      {
        window: WEEK,
        nutrientIds: [ENERGY],
      },
    );
    expect(review.days[0].included).toBe(true);
  });

  it("honours a caller-supplied coverage floor", () => {
    const entries = [entry({ date: "2026-08-03", kcal: 800, coverage: 0.5 })];
    expect(habitReview(entries, { window: WEEK, nutrientIds: [ENERGY] }).days[0].included).toBe(
      false,
    );
    expect(
      habitReview(entries, { window: WEEK, nutrientIds: [ENERGY], minCoverage: 0.4 }).days[0]
        .included,
    ).toBe(true);
  });

  it("excludes a day per nutrient when one meal never reported that nutrient", () => {
    // The day counts for energy — both meals reported it — but a protein total
    // that quietly omits one dinner is worse than no protein total.
    const review = habitReview(
      [
        entry({ date: "2026-08-03", kcal: 500, protein: 30 }),
        entry({ date: "2026-08-03", kcal: 400, recipeId: "r2" }),
      ],
      { window: WEEK, nutrientIds: [ENERGY, PROTEIN] },
    );

    expect(review.days[0].included).toBe(true);
    expect(trend(review, ENERGY).points[0]).toMatchObject({ value: 900, included: true });
    expect(trend(review, PROTEIN).points[0]).toMatchObject({
      value: null,
      included: false,
      reason: "nutrient-missing",
    });
    expect(trend(review, PROTEIN).average).toBeNull();
  });
});

describe("habitReview — totals", () => {
  it("sums a day's meals", () => {
    const review = habitReview(
      [
        entry({ date: "2026-08-03", kcal: 500 }),
        entry({ date: "2026-08-03", kcal: 350, recipeId: "r2" }),
      ],
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(trend(review, ENERGY).points[0].value).toBe(850);
  });

  it("scales the snapshot by the row's servings multiplier", () => {
    // The snapshot is one whole recipe yield; eating a double batch is 2x.
    const review = habitReview([entry({ date: "2026-08-03", kcal: 600, servings: 2 })], {
      window: WEEK,
      nutrientIds: [ENERGY],
    });
    expect(trend(review, ENERGY).points[0].value).toBe(1200);
  });

  it("takes the unit from the logged snapshot", () => {
    const review = habitReview([entry({ date: "2026-08-03", kcal: 600, protein: 40 })], {
      window: WEEK,
      nutrientIds: [ENERGY, PROTEIN],
    });
    expect(trend(review, ENERGY).unit).toBe("kcal");
    expect(trend(review, PROTEIN).unit).toBe("g");
  });

  it("averages over included days only", () => {
    const review = habitReview(
      [
        entry({ date: "2026-08-03", kcal: 1000 }),
        entry({ date: "2026-08-05", kcal: 2000 }),
        entry({ date: "2026-08-07", kcal: 600, coverage: 0.1, recipeId: "r3" }),
      ],
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    const energy = trend(review, ENERGY);
    expect(energy.includedDays).toBe(2);
    expect(energy.excludedDays).toBe(5);
    expect(energy.total).toBe(3000);
    expect(energy.average).toBe(1500);
  });
});

describe("habitReview — drift", () => {
  const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];

  it("calls a climbing nutrient rising", () => {
    const review = habitReview(
      days.map((date, i) => entry({ date, kcal: 1000 + i * 400 })),
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(trend(review, ENERGY).direction).toBe("rising");
  });

  it("calls a falling nutrient falling", () => {
    const review = habitReview(
      days.map((date, i) => entry({ date, kcal: 2200 - i * 400 })),
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(trend(review, ENERGY).direction).toBe("falling");
  });

  it("calls small wobble steady", () => {
    const review = habitReview(
      days.map((date, i) => entry({ date, kcal: 2000 + (i % 2 === 0 ? 20 : -20) })),
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(trend(review, ENERGY).direction).toBe("steady");
  });

  it("refuses a direction from too few days", () => {
    const review = habitReview(
      [entry({ date: "2026-08-03", kcal: 1000 }), entry({ date: "2026-08-04", kcal: 3000 })],
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(trend(review, ENERGY).direction).toBe("unknown");
  });
});

describe("habitSignal", () => {
  it("says nothing is logged when nothing is", () => {
    expect(habitSignal([])).toEqual({ sources: [], label: "Nothing logged yet" });
  });

  it("says 'your plan' and warns it is intention, not consumption", () => {
    const signal = habitSignal([entry({ date: "2026-08-03", kcal: 500, source: "planned" })]);
    expect(signal.sources).toEqual(["planned"]);
    expect(signal.label).toBe("Based on your plan");
    expect(signal.caveat).toMatch(/not confirmation you cooked them/);
  });

  it("upgrades to 'what you cooked' with no caveat once cooked rows exist", () => {
    const signal = habitSignal([entry({ date: "2026-08-03", kcal: 500, source: "cooked" })]);
    expect(signal.label).toBe("Based on what you cooked");
    expect(signal.caveat).toBeUndefined();
  });

  it("names both signals when the window mixes them", () => {
    const signal = habitSignal([
      entry({ date: "2026-08-03", kcal: 500, source: "planned" }),
      entry({ date: "2026-08-04", kcal: 500, source: "cooked" }),
    ]);
    expect(signal.sources).toEqual(["cooked", "planned"]);
    expect(signal.label).toBe("Based on what you cooked and your plan");
    expect(signal.caveat).toBeDefined();
  });

  it("names all three when a manual entry joins them", () => {
    const signal = habitSignal([
      entry({ date: "2026-08-03", kcal: 500, source: "planned" }),
      entry({ date: "2026-08-04", kcal: 500, source: "cooked" }),
      entry({ date: "2026-08-05", kcal: 500, source: "manual" }),
    ]);
    expect(signal.label).toBe("Based on what you cooked, your plan and meals you logged");
  });

  it("is derived from the window, not the whole log", () => {
    const review = habitReview(
      [
        entry({ date: "2026-07-01", kcal: 500, source: "cooked" }),
        entry({ date: "2026-08-03", kcal: 500, source: "planned" }),
      ],
      { window: WEEK, nutrientIds: [ENERGY] },
    );
    expect(review.signal.sources).toEqual(["planned"]);
  });
});

describe("exclusionLabel", () => {
  it("explains every reason in plain words", () => {
    expect(exclusionLabel("no-entries")).toBe("nothing logged");
    expect(exclusionLabel("low-coverage")).toBe("too little of the meal identified");
    expect(exclusionLabel("nutrient-missing")).toBe("no figure for this nutrient");
  });
});

describe("goalMetRates", () => {
  const protein = (over: Partial<NutritionTarget> = {}): NutritionTarget => ({
    nutrientId: PROTEIN,
    operator: ">=",
    value: 100,
    period: "day",
    active: true,
    ...over,
  });

  it("counts the days a goal was met", () => {
    const rates = goalMetRates(
      [
        entry({ date: "2026-08-03", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-04", kcal: 500, protein: 130 }),
        entry({ date: "2026-08-05", kcal: 500, protein: 40 }),
      ],
      { window: WEEK, targets: [protein()] },
    );

    expect(rates[0]).toMatchObject({ evaluatedDays: 3, metDays: 2, unknownDays: 0 });
    expect(rates[0].rate).toBeCloseTo(2 / 3);
  });

  it("leaves unlogged days out of the fraction entirely", () => {
    // Four days of the window have nothing logged. They are neither hits nor
    // misses — a denominator of 7 would report absence as failure.
    const rates = goalMetRates(
      [
        entry({ date: "2026-08-03", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-04", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-05", kcal: 500, protein: 40 }),
      ],
      { window: WEEK, targets: [protein()] },
    );

    expect(rates[0].evaluatedDays).toBe(3);
    expect(rates[0].rate).toBeCloseTo(2 / 3);
  });

  it("leaves a low-coverage day out of both sides, counting it as unknown", () => {
    const rates = goalMetRates(
      [
        entry({ date: "2026-08-03", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-04", kcal: 500, protein: 10, coverage: 0.2 }),
      ],
      { window: WEEK, targets: [protein()] },
    );

    expect(rates[0]).toMatchObject({ evaluatedDays: 1, metDays: 1, unknownDays: 1 });
    // Not 1/2 — the unidentifiable day is not a miss.
    expect(rates[0].rate).toBe(1);
  });

  it("treats a day whose meal never reported the nutrient as unknown", () => {
    const rates = goalMetRates(
      [
        entry({ date: "2026-08-03", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-04", kcal: 500, protein: 120 }),
        entry({ date: "2026-08-04", kcal: 400, recipeId: "r2" }),
      ],
      { window: WEEK, targets: [protein()] },
    );

    expect(rates[0]).toMatchObject({ evaluatedDays: 1, unknownDays: 1 });
  });

  it("sums a day's meals and scales by servings before judging", () => {
    // 60 g × 2 servings = 120 g, which clears a 100 g goal that one batch misses.
    const rates = goalMetRates([entry({ date: "2026-08-03", protein: 60, servings: 2 })], {
      window: WEEK,
      targets: [protein()],
    });
    expect(rates[0]).toMatchObject({ metDays: 1, evaluatedDays: 1 });
  });

  it("reports null rather than 0% when no day could be judged", () => {
    const rates = goalMetRates([], { window: WEEK, targets: [protein()] });
    expect(rates[0]).toMatchObject({ evaluatedDays: 0, metDays: 0, rate: null });
  });

  it("honours a cap as readily as a floor", () => {
    const rates = goalMetRates(
      [entry({ date: "2026-08-03", kcal: 1500 }), entry({ date: "2026-08-04", kcal: 2500 })],
      {
        window: WEEK,
        targets: [{ nutrientId: ENERGY, operator: "<=", value: 2000, period: "day", active: true }],
      },
    );
    expect(rates[0]).toMatchObject({ evaluatedDays: 2, metDays: 1 });
  });

  it("ignores inactive targets and targets for other periods", () => {
    const rates = goalMetRates([entry({ date: "2026-08-03", protein: 120 })], {
      window: WEEK,
      targets: [
        protein({ active: false }),
        protein({ period: "week" }),
        protein({ period: "meal" }),
        protein(),
      ],
    });
    expect(rates).toHaveLength(1);
    expect(rates[0].target.period).toBe("day");
  });

  it("ignores entries outside the window", () => {
    const rates = goalMetRates(
      [entry({ date: "2026-07-01", protein: 10 }), entry({ date: "2026-08-03", protein: 120 })],
      { window: WEEK, targets: [protein()] },
    );
    expect(rates[0]).toMatchObject({ evaluatedDays: 1, metDays: 1 });
  });
});
