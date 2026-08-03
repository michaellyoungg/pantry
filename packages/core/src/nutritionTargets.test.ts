import type { NutritionTarget, NutritionTargetPeriod } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { HEADLINE_NUTRIENTS, NUTRITION_COVERAGE_THRESHOLD, nutrientMeta } from "./nutrition";
import { EQUALITY_BAND, evaluateTargets, type NutritionVector } from "./nutritionTargets";

const PROTEIN = "1003";
const CHOLESTEROL = "1253";
const CARBS = "1005";

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return {
    nutrientId: PROTEIN,
    operator: ">=",
    value: 150,
    period: "day",
    active: true,
    ...over,
  };
}

/** A vector with full coverage unless told otherwise. */
function vector(
  nutrients: Record<string, number>,
  over: Partial<NutritionVector["coverage"]> = {},
): NutritionVector {
  return {
    nutrients: Object.fromEntries(
      Object.entries(nutrients).map(([id, amount]) => [
        id,
        { nutrientId: id, amount, unit: nutrientMeta(id)?.unit ?? "g" },
      ]),
    ),
    coverage: { resolvedMassFraction: 1, resolvedCount: 4, totalCount: 4, ...over },
  };
}

describe("evaluateTargets — operators", () => {
  it("reports a `>=` target as met when the amount reaches it", () => {
    const [result] = evaluateTargets([target({ value: 150 })], vector({ [PROTEIN]: 160 }), "day");
    expect(result.status).toBe("met");
    expect(result.actual).toBe(160);
  });

  it("reports a `>=` target as under when the amount falls short", () => {
    const [result] = evaluateTargets([target({ value: 150 })], vector({ [PROTEIN]: 120 }), "day");
    expect(result.status).toBe("under");
  });

  it("treats a `>=` target as met at exactly the target value", () => {
    const [result] = evaluateTargets([target({ value: 150 })], vector({ [PROTEIN]: 150 }), "day");
    expect(result.status).toBe("met");
  });

  it("treats a `>=` target as met despite floating-point summation drift", () => {
    // 0.1 + 0.2 style drift: three 50 g portions summing just below 150.
    const drifted = 150 - 1e-13;
    const [result] = evaluateTargets(
      [target({ value: 150 })],
      vector({ [PROTEIN]: drifted }),
      "day",
    );
    expect(result.status).toBe("met");
  });

  it("reports a `<=` target as met when the amount stays under the cap", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [CHOLESTEROL]: 140 }), "day");
    expect(result.status).toBe("met");
  });

  it("reports a `<=` target as over when the amount exceeds the cap", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [CHOLESTEROL]: 260 }), "day");
    expect(result.status).toBe("over");
    expect(result.actual).toBe(260);
  });

  it("treats a `<=` target as met at exactly the cap", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [CHOLESTEROL]: 200 }), "day");
    expect(result.status).toBe("met");
  });

  it("reports an `==` target as met inside the tolerance band", () => {
    const t = target({ operator: "==", value: 100 });
    const inside = 100 * (1 + EQUALITY_BAND / 2);
    const [result] = evaluateTargets([t], vector({ [PROTEIN]: inside }), "day");
    expect(result.status).toBe("met");
  });

  it("reports an `==` target as over above the tolerance band", () => {
    const t = target({ operator: "==", value: 100 });
    const outside = 100 * (1 + EQUALITY_BAND * 2);
    const [result] = evaluateTargets([t], vector({ [PROTEIN]: outside }), "day");
    expect(result.status).toBe("over");
  });

  it("reports an `==` target as under below the tolerance band", () => {
    const t = target({ operator: "==", value: 100 });
    const outside = 100 * (1 - EQUALITY_BAND * 2);
    const [result] = evaluateTargets([t], vector({ [PROTEIN]: outside }), "day");
    expect(result.status).toBe("under");
  });
});

describe("evaluateTargets — unknown never reads as reassurance", () => {
  // This is the property the whole feature rests on. A recipe whose ingredients
  // could not be identified contributes 0 to the summed vector. If that 0 were
  // evaluated, a cholesterol cap would read "met" precisely because we failed to
  // measure it — absent data presented as a clean bill of health.

  it("reports `unknown`, not `met`, for a cap when coverage is too low", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const half = vector({ [CHOLESTEROL]: 20 }, { resolvedMassFraction: 0.5, resolvedCount: 2 });
    const [result] = evaluateTargets([t], half, "day");
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("low-coverage");
    expect(result.actual).toBeNull();
  });

  it("reports `unknown`, not `under`, for a floor when coverage is too low", () => {
    const low = vector({ [PROTEIN]: 10 }, { resolvedMassFraction: 0.2, resolvedCount: 1 });
    const [result] = evaluateTargets([target()], low, "day");
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("low-coverage");
  });

  it("never reports a low-coverage cap as met for any amount below it", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    for (const amount of [0, 1, 50, 199]) {
      const low = vector(
        { [CHOLESTEROL]: amount },
        { resolvedMassFraction: 0.3, resolvedCount: 1 },
      );
      expect(evaluateTargets([t], low, "day")[0].status).toBe("unknown");
    }
  });

  it("reports `unknown` when the estimate is missing entirely", () => {
    const [result] = evaluateTargets([target()], null, "day");
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("no-estimate");
    expect(result.coverage).toBeNull();
  });

  it("reports `unknown` when nothing at all was planned", () => {
    const empty = vector({}, { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 });
    const [result] = evaluateTargets([target()], empty, "day");
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("no-estimate");
  });

  it("reports `unknown` when the nutrient is absent from a well-covered estimate", () => {
    // Coverage is about mass resolved, not about every nutrient being present.
    // A food matched without a cholesterol figure is not a food with zero
    // cholesterol, so a cap on it stays unanswered rather than passing.
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [PROTEIN]: 90 }), "day");
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("nutrient-missing");
  });

  it("evaluates normally at exactly the coverage threshold", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const atThreshold = vector(
      { [CHOLESTEROL]: 140 },
      { resolvedMassFraction: NUTRITION_COVERAGE_THRESHOLD },
    );
    expect(evaluateTargets([t], atThreshold, "day")[0].status).toBe("met");
  });

  it("still reports a genuine zero as met when coverage is good", () => {
    // Zero is a real answer when we actually measured it — the rule suppresses
    // unmeasured zeros, not measured ones.
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [CHOLESTEROL]: 0 }), "day");
    expect(result.status).toBe("met");
    expect(result.actual).toBe(0);
  });
});

describe("evaluateTargets — selection", () => {
  it("evaluates only targets for the requested period", () => {
    const targets = [
      target({ period: "day", nutrientId: PROTEIN }),
      target({ period: "week", nutrientId: CARBS }),
      target({ period: "meal", nutrientId: CHOLESTEROL }),
    ];
    const results = evaluateTargets(targets, vector({ [PROTEIN]: 160, [CARBS]: 40 }), "week");
    expect(results.map((r) => r.target.nutrientId)).toEqual([CARBS]);
  });

  it("skips inactive targets so pausing a diet is not a delete", () => {
    const targets = [
      target({ active: false }),
      target({ nutrientId: CARBS, operator: "<=", value: 50 }),
    ];
    const results = evaluateTargets(targets, vector({ [PROTEIN]: 160, [CARBS]: 40 }), "day");
    expect(results).toHaveLength(1);
    expect(results[0].target.nutrientId).toBe(CARBS);
  });

  it("preserves the order the targets were given in", () => {
    const targets = [
      target({ nutrientId: CARBS, operator: "<=", value: 50 }),
      target({ nutrientId: PROTEIN }),
    ];
    const results = evaluateTargets(targets, vector({ [PROTEIN]: 160, [CARBS]: 40 }), "day");
    expect(results.map((r) => r.target.nutrientId)).toEqual([CARBS, PROTEIN]);
  });

  it("returns nothing when no target applies", () => {
    expect(evaluateTargets([], vector({ [PROTEIN]: 160 }), "day")).toEqual([]);
  });
});

describe("evaluateTargets — reported detail", () => {
  it("carries the estimate's unit through", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [CHOLESTEROL]: 140 }), "day");
    expect(result.unit).toBe("mg");
  });

  it("falls back to the nutrient catalog's unit when the amount is unknown", () => {
    const t = target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200 });
    const [result] = evaluateTargets([t], vector({ [PROTEIN]: 90 }), "day");
    expect(result.status).toBe("unknown");
    expect(result.unit).toBe("mg");
  });

  it("reports the coverage it judged against", () => {
    const v = vector({ [PROTEIN]: 160 }, { resolvedMassFraction: 0.9 });
    const [result] = evaluateTargets([target()], v, "day");
    expect(result.coverage).toBe(0.9);
  });
});

describe("shared nutrient vocabulary", () => {
  it("resolves a known nutrient's label and unit", () => {
    expect(nutrientMeta("1003")).toEqual({ id: "1003", label: "Protein", unit: "g" });
  });

  it("returns undefined for a nutrient it does not surface", () => {
    expect(nutrientMeta("9999")).toBeUndefined();
  });

  it("covers every nutrient the stated scenarios need", () => {
    const ids = HEADLINE_NUTRIENTS.map((n) => n.id);
    // energy, protein, fat, carbs, saturated fat, fiber, sodium, cholesterol
    expect(ids).toEqual(
      expect.arrayContaining(["1008", "1003", "1004", "1005", "1258", "1079", "1093", "1253"]),
    );
  });

  it("uses unique ids", () => {
    const ids = HEADLINE_NUTRIENTS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("period typing", () => {
  it("accepts every declared period", () => {
    const periods: NutritionTargetPeriod[] = ["day", "week", "meal"];
    for (const period of periods) {
      expect(
        evaluateTargets([target({ period })], vector({ [PROTEIN]: 160 }), period),
      ).toHaveLength(1);
    }
  });
});
