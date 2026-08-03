import { NUTRITION_COVERAGE_THRESHOLD } from "@pantry/core";
import type { NutritionEstimate, NutritionIngredient } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { nutritionDisplay } from "./nutrition";

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

describe("nutritionDisplay", () => {
  it("shows the headline nutrients when coverage is good", () => {
    const display = nutritionDisplay(estimate());
    expect(display.kind).toBe("estimate");
    if (display.kind !== "estimate") return;

    expect(display.coveragePercent).toBe(100);
    expect(display.servings).toBe(0);
    expect(display.rows).toEqual([
      { id: "1008", label: "Calories", total: "455 kcal", perServing: undefined },
      { id: "1003", label: "Protein", total: "12.9 g", perServing: undefined },
      { id: "1093", label: "Sodium", total: "3 mg", perServing: undefined },
    ]);
  });

  // BL-0035 made the yield optional, so both shapes have to render honestly.
  it("carries per-serving amounts alongside the totals when the yield is known", () => {
    const display = nutritionDisplay(
      estimate({
        servings: 4,
        perServing: {
          "1008": { nutrientId: "1008", amount: 113.75, unit: "kcal" },
          "1003": { nutrientId: "1003", amount: 3.228, unit: "g" },
          "1093": { nutrientId: "1093", amount: 0.625, unit: "mg" },
        },
      }),
    );
    if (display.kind !== "estimate") throw new Error(`expected an estimate, got ${display.kind}`);
    expect(display.servings).toBe(4);
    expect(display.rows[0]).toEqual({
      id: "1008",
      label: "Calories",
      total: "455 kcal",
      perServing: "114 kcal",
    });
  });

  // A servings count with no perServing map means the server declined to divide;
  // trusting the count alone would render a per-serving heading over totals.
  it("ignores a servings count the estimate did not actually divide by", () => {
    const display = nutritionDisplay(estimate({ servings: 4 }));
    if (display.kind !== "estimate") throw new Error(`expected an estimate, got ${display.kind}`);
    expect(display.servings).toBe(0);
  });

  it("orders rows for display, not by the order the estimate happened to carry", () => {
    const display = nutritionDisplay(
      estimate({
        nutrients: {
          "1253": { nutrientId: "1253", amount: 457, unit: "mg" },
          "1008": { nutrientId: "1008", amount: 950, unit: "kcal" },
        },
      }),
    );
    if (display.kind !== "estimate") throw new Error(`expected an estimate, got ${display.kind}`);
    expect(display.rows.map((r) => r.label)).toEqual(["Calories", "Cholesterol"]);
  });

  // The core contract: below the threshold the user sees what is missing, never
  // a bare figure that looks complete.
  it("suppresses the figures below the coverage threshold and names the gaps", () => {
    const display = nutritionDisplay(
      estimate({
        coverage: { resolvedMassFraction: 0.32, resolvedCount: 1, totalCount: 3 },
        ingredients: [
          { item: "rice", grams: 185, resolved: true },
          { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
          { item: "tempeh", grams: 200, resolved: false, reason: "no nutrition data" },
        ],
      }),
    );
    expect(display.kind).toBe("unavailable");
    if (display.kind !== "unavailable") return;
    expect(display.missing).toEqual(["gochujang", "tempeh"]);
    expect(display.coveragePercent).toBe(32);
  });

  it("treats the threshold itself as good enough", () => {
    const atThreshold = nutritionDisplay(
      estimate({
        coverage: {
          resolvedMassFraction: NUTRITION_COVERAGE_THRESHOLD,
          resolvedCount: 4,
          totalCount: 5,
        },
      }),
    );
    expect(atThreshold.kind).toBe("estimate");

    const justBelow = nutritionDisplay(
      estimate({
        coverage: {
          resolvedMassFraction: NUTRITION_COVERAGE_THRESHOLD - 0.01,
          resolvedCount: 4,
          totalCount: 5,
        },
      }),
    );
    expect(justBelow.kind).toBe("unavailable");
  });

  it("still names the gaps when coverage is good but not total", () => {
    const display = nutritionDisplay(
      estimate({
        coverage: { resolvedMassFraction: 0.95, resolvedCount: 2, totalCount: 3 },
        ingredients: [
          { item: "flour", grams: 125, resolved: true },
          { item: "milk", grams: 244, resolved: true },
          { item: "salt", grams: null, resolved: false, reason: "trace measure" },
        ],
      }),
    );
    if (display.kind !== "estimate") throw new Error(`expected an estimate, got ${display.kind}`);
    expect(display.missing).toEqual(["salt"]);
    expect(display.coveragePercent).toBe(95);
  });

  it("reports an empty recipe as empty rather than as zero calories", () => {
    const display = nutritionDisplay(
      estimate({
        nutrients: {},
        ingredients: [],
        coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
      }),
    );
    expect(display.kind).toBe("empty");
  });

  // Full coverage with nothing recognised should not render an empty table.
  it("falls back to unavailable when no headline nutrient is present", () => {
    const display = nutritionDisplay(
      estimate({ nutrients: { "9999": { nutrientId: "9999", amount: 1, unit: "" } } }),
    );
    expect(display.kind).toBe("unavailable");
  });
});
