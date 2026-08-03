import type { NutritionEstimate, NutritionIngredient } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { COVERAGE_THRESHOLD, formatAmount, nutritionDisplay, unresolvedItems } from "./nutrition";

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

describe("formatAmount", () => {
  it("gives grams a decimal and everything else none", () => {
    expect(formatAmount({ nutrientId: "1003", amount: 12.913, unit: "g" })).toBe("12.9 g");
    expect(formatAmount({ nutrientId: "1008", amount: 455.4, unit: "kcal" })).toBe("455 kcal");
    expect(formatAmount({ nutrientId: "1093", amount: 1594.772, unit: "mg" })).toBe("1595 mg");
  });

  it("omits an unknown unit rather than printing undefined", () => {
    expect(formatAmount({ nutrientId: "9999", amount: 42, unit: "" })).toBe("42");
  });
});

describe("unresolvedItems", () => {
  it("names the ingredients that did not make it in, in recipe order", () => {
    const est = estimate({
      ingredients: [
        { item: "flour", grams: 125, resolved: true },
        { item: "saffron", grams: null, resolved: false, reason: "no food match" },
        { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
      ],
    });
    expect(unresolvedItems(est)).toEqual(["saffron", "gochujang"]);
  });
});

describe("nutritionDisplay", () => {
  it("shows the headline nutrients when coverage is good", () => {
    const display = nutritionDisplay(estimate());
    expect(display.kind).toBe("estimate");
    if (display.kind !== "estimate") return;

    expect(display.coveragePercent).toBe(100);
    expect(display.rows).toEqual([
      { id: "1008", label: "Calories", value: "455 kcal" },
      { id: "1003", label: "Protein", value: "12.9 g" },
      { id: "1093", label: "Sodium", value: "3 mg" },
    ]);
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
        coverage: { resolvedMassFraction: COVERAGE_THRESHOLD, resolvedCount: 4, totalCount: 5 },
      }),
    );
    expect(atThreshold.kind).toBe("estimate");

    const justBelow = nutritionDisplay(
      estimate({
        coverage: {
          resolvedMassFraction: COVERAGE_THRESHOLD - 0.01,
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
