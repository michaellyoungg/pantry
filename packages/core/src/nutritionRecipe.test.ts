import type { NutritionEstimate, NutritionIngredient, NutritionTarget } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { NUTRITION_COVERAGE_THRESHOLD } from "./nutrition";
import { recipeGoalFit, recipeNutritionView } from "./nutritionRecipe";

function estimate(overrides: Partial<NutritionEstimate> = {}): NutritionEstimate {
  const ingredients: NutritionIngredient[] = [
    { item: "flour", grams: 125, resolved: true, method: "portion" },
  ];
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 455, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 12.913, unit: "g" },
      "1093": { nutrientId: "1093", amount: 2.5, unit: "mg" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ingredients,
    estimatedAt: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

/** The same dish, with a yield the server was willing to divide by. */
function servedFour(overrides: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return estimate({
    servings: 4,
    perServing: {
      "1008": { nutrientId: "1008", amount: 113.75, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 3.228, unit: "g" },
      "1093": { nutrientId: "1093", amount: 0.625, unit: "mg" },
    },
    ...overrides,
  });
}

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return { nutrientId: "1003", operator: ">=", value: 3, period: "meal", active: true, ...over };
}

function amountFor(rows: { id: string; amount: { amount: number } | null }[], id: string) {
  return rows.find((r) => r.id === id)?.amount;
}

describe("recipeNutritionView", () => {
  it("labels the whole recipe when there is no yield to divide by", () => {
    const view = recipeNutritionView(estimate());
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.coveragePercent).toBe(100);
    expect(view.servingsLabel).toBe("Entire recipe");
    expect(amountFor(view.rows, "1008")).toEqual({ nutrientId: "1008", amount: 455, unit: "kcal" });
  });

  // BL-0035 made the yield optional, so both shapes have to render honestly.
  it("leads with the per-serving figures when the yield is known", () => {
    const view = recipeNutritionView(servedFour());
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.servingsLabel).toBe("4 servings per recipe");
    expect(amountFor(view.rows, "1008")?.amount).toBe(113.75);
  });

  it("says 'serving' rather than 'servings' for a recipe that makes one", () => {
    const view = recipeNutritionView(
      servedFour({
        servings: 1,
        perServing: { "1008": { nutrientId: "1008", amount: 455, unit: "kcal" } },
      }),
    );
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.servingsLabel).toBe("1 serving per recipe");
  });

  // A servings count with no perServing map means the server declined to divide;
  // trusting the count alone would render a per-serving heading over totals.
  it("ignores a servings count the estimate did not actually divide by", () => {
    const view = recipeNutritionView(estimate({ servings: 4 }));
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.servingsLabel).toBe("Entire recipe");
    expect(amountFor(view.rows, "1008")?.amount).toBe(455);
  });

  // The label's shape is fixed; a nutrient we do not have is a dash, never a 0.
  it("keeps a row for a nutrient the estimate does not carry, with no amount", () => {
    const view = recipeNutritionView(estimate());
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(amountFor(view.rows, "1253")).toBeNull();
    expect(view.rows.map((r) => r.label)).toContain("Cholesterol");
  });

  // The core contract: below the threshold the user sees what is missing, never
  // a bare figure that looks complete.
  it("suppresses the figures below the coverage threshold and names the gaps", () => {
    const view = recipeNutritionView(
      estimate({
        coverage: { resolvedMassFraction: 0.32, resolvedCount: 1, totalCount: 3 },
        ingredients: [
          { item: "rice", grams: 185, resolved: true },
          { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
          { item: "tempeh", grams: 200, resolved: false, reason: "no nutrition data" },
        ],
      }),
    );

    expect(view.kind).toBe("unavailable");
    if (view.kind !== "unavailable") return;
    expect(view.missing).toEqual(["gochujang", "tempeh"]);
    expect(view.coveragePercent).toBe(32);
  });

  it("treats the threshold itself as good enough", () => {
    const coverage = (resolvedMassFraction: number) => ({
      coverage: { resolvedMassFraction, resolvedCount: 4, totalCount: 5 },
    });

    expect(recipeNutritionView(estimate(coverage(NUTRITION_COVERAGE_THRESHOLD))).kind).toBe(
      "estimate",
    );
    expect(recipeNutritionView(estimate(coverage(NUTRITION_COVERAGE_THRESHOLD - 0.01))).kind).toBe(
      "unavailable",
    );
  });

  it("still names the gaps when coverage is good but not total", () => {
    const view = recipeNutritionView(
      estimate({
        coverage: { resolvedMassFraction: 0.95, resolvedCount: 2, totalCount: 3 },
        ingredients: [
          { item: "flour", grams: 125, resolved: true },
          { item: "milk", grams: 244, resolved: true },
          { item: "salt", grams: null, resolved: false, reason: "trace measure" },
        ],
      }),
    );
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.missing).toEqual(["salt"]);
    expect(view.coveragePercent).toBe(95);
  });

  it("reports an empty recipe as empty rather than as zero calories", () => {
    const view = recipeNutritionView(
      estimate({
        nutrients: {},
        ingredients: [],
        coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
      }),
    );

    expect(view.kind).toBe("empty");
  });

  // Full coverage with nothing recognised should not render an empty label.
  it("falls back to unavailable when no headline nutrient is present", () => {
    const view = recipeNutritionView(
      estimate({ nutrients: { "9999": { nutrientId: "9999", amount: 1, unit: "" } } }),
    );

    expect(view.kind).toBe("unavailable");
  });

  it("scores the personal column against per-meal goals, per serving", () => {
    const view = recipeNutritionView(servedFour(), [target({ nutrientId: "1003", value: 6 })]);
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    const protein = view.rows.find((r) => r.id === "1003");
    expect(protein?.hasTarget).toBe(true);
    // 3.228 g of a 6 g goal — the serving's share, not the pot's.
    expect(protein?.targetPercent).toBe(54);
  });

  // A `meal` target is written against one serving. Scoring a whole recipe
  // against it would report a four-serving casserole as four times over.
  it("draws no personal column on a recipe with no yield", () => {
    const view = recipeNutritionView(estimate(), [target({ nutrientId: "1003", value: 6 })]);
    if (view.kind !== "estimate") throw new Error(`expected an estimate, got ${view.kind}`);

    expect(view.rows.every((r) => !r.hasTarget)).toBe(true);
  });

  // The case a user most needs told about is the one where we could not measure.
  it("still answers the goals when coverage is too low for a figure", () => {
    const view = recipeNutritionView(
      servedFour({ coverage: { resolvedMassFraction: 0.3, resolvedCount: 1, totalCount: 3 } }),
      [target()],
    );
    if (view.kind !== "unavailable") throw new Error(`expected unavailable, got ${view.kind}`);

    expect(view.goalFit).toEqual({
      kind: "verdict",
      verdict: "unknown",
      evaluations: [expect.objectContaining({ status: "unknown", reason: "low-coverage" })],
    });
  });
});

describe("recipeGoalFit", () => {
  it("says nothing when no per-meal goal is set", () => {
    expect(recipeGoalFit(servedFour(), [])).toEqual({ kind: "no-goals" });
    expect(recipeGoalFit(servedFour(), [target({ period: "day" })])).toEqual({ kind: "no-goals" });
    expect(recipeGoalFit(servedFour(), [target({ active: false })])).toEqual({ kind: "no-goals" });
  });

  // Treating "serves unknown" as "serves one" would re-introduce the guess the
  // server refused to make, at the point it does the most damage.
  it("asks for a serving count rather than judging the whole pot", () => {
    expect(recipeGoalFit(estimate(), [target()])).toEqual({ kind: "no-servings" });
  });

  it("fits when every per-meal goal is met by one serving", () => {
    const fit = recipeGoalFit(servedFour(), [target({ value: 3 })]);

    expect(fit).toMatchObject({ kind: "verdict", verdict: "fits" });
  });

  it("misses when a goal is broken", () => {
    const fit = recipeGoalFit(servedFour(), [target({ value: 40 })]);

    expect(fit).toMatchObject({ kind: "verdict", verdict: "misses" });
  });

  // One met goal beside one we could not measure is not a fit: saying so would
  // let the nutrient we failed to measure pass as within limits.
  it("cannot tell when any goal is unmeasurable, even beside a met one", () => {
    const fit = recipeGoalFit(servedFour(), [
      target({ value: 3 }),
      target({ nutrientId: "1253", operator: "<=", value: 200 }),
    ]);

    expect(fit).toMatchObject({ kind: "verdict", verdict: "unknown" });
  });
});
