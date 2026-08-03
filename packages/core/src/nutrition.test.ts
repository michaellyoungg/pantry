import type { NutritionEstimate } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { formatNutrientAmount, nutrientRows, unresolvedItems } from "./nutrition";

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {},
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ingredients: [],
    estimatedAt: "2026-08-03T12:00:00Z",
    ...over,
  };
}

describe("formatNutrientAmount", () => {
  it("gives grams a decimal and everything else none", () => {
    expect(formatNutrientAmount({ nutrientId: "1003", amount: 12.913, unit: "g" })).toBe("12.9 g");
    expect(formatNutrientAmount({ nutrientId: "1008", amount: 455.4, unit: "kcal" })).toBe(
      "455 kcal",
    );
    expect(formatNutrientAmount({ nutrientId: "1093", amount: 1594.772, unit: "mg" })).toBe(
      "1595 mg",
    );
  });

  it("omits an unknown unit rather than printing undefined", () => {
    expect(formatNutrientAmount({ nutrientId: "9999", amount: 42, unit: "" })).toBe("42");
  });
});

describe("nutrientRows", () => {
  it("orders rows for display, not by the order the vector happened to carry", () => {
    const rows = nutrientRows({
      "1253": { nutrientId: "1253", amount: 457, unit: "mg" },
      "1008": { nutrientId: "1008", amount: 950, unit: "kcal" },
    });
    expect(rows.map((r) => r.label)).toEqual(["Calories", "Cholesterol"]);
  });

  it("skips a nutrient the estimate does not carry rather than showing zero", () => {
    const rows = nutrientRows({ "1008": { nutrientId: "1008", amount: 950, unit: "kcal" } });
    expect(rows).toEqual([{ id: "1008", label: "Calories", value: "950 kcal" }]);
  });

  it("divides by the divisor", () => {
    const rows = nutrientRows({ "1008": { nutrientId: "1008", amount: 900, unit: "kcal" } }, 3);
    expect(rows[0].value).toBe("300 kcal");
  });

  it("returns nothing for a missing vector or a nonsensical divisor", () => {
    expect(nutrientRows(undefined)).toEqual([]);
    expect(nutrientRows({ "1008": { nutrientId: "1008", amount: 900, unit: "kcal" } }, 0)).toEqual(
      [],
    );
  });
});

describe("unresolvedItems", () => {
  it("names the ingredients that did not make it in, in order", () => {
    const est = estimate({
      ingredients: [
        { item: "flour", grams: 125, resolved: true },
        { item: "saffron", grams: null, resolved: false, reason: "no food match" },
        { item: "gochujang", grams: null, resolved: false, reason: "no food match" },
      ],
    });
    expect(unresolvedItems(est)).toEqual(["saffron", "gochujang"]);
  });

  // A rollup concatenates several recipes' lines, so the same missing item
  // arrives repeatedly; naming it three times reads as three problems.
  it("names a repeated missing ingredient once", () => {
    const est = estimate({
      ingredients: [
        { item: "saffron", grams: null, resolved: false },
        { item: "saffron", grams: null, resolved: false },
      ],
    });
    expect(unresolvedItems(est)).toEqual(["saffron"]);
  });
});
