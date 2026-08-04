import type { NutrientAmount, NutritionTarget } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  DAILY_VALUES,
  hasTargetColumn,
  type NutritionFactsRow,
  nutritionFactsLabel,
} from "./nutritionFacts";

const CALORIES = "1008";
const PROTEIN = "1003";
const FAT = "1004";
const SAT_FAT = "1258";
const TRANS_FAT = "1257";
const CHOLESTEROL = "1253";
const SODIUM = "1093";
const CARBS = "1005";
const FIBER = "1079";
const TOTAL_SUGARS = "2000";
const ADDED_SUGARS = "1235";
const VITAMIN_D = "1114";
const CALCIUM = "1087";
const IRON = "1089";
const POTASSIUM = "1092";

const UNITS: Record<string, string> = {
  [CALORIES]: "kcal",
  [PROTEIN]: "g",
  [FAT]: "g",
  [SAT_FAT]: "g",
  [TRANS_FAT]: "g",
  [CHOLESTEROL]: "mg",
  [SODIUM]: "mg",
  [CARBS]: "g",
  [FIBER]: "g",
  [TOTAL_SUGARS]: "g",
  [ADDED_SUGARS]: "g",
  [VITAMIN_D]: "µg",
  [CALCIUM]: "mg",
  [IRON]: "mg",
  [POTASSIUM]: "mg",
};

function vector(amounts: Record<string, number>): Record<string, NutrientAmount> {
  return Object.fromEntries(
    Object.entries(amounts).map(([id, amount]) => [
      id,
      { nutrientId: id, amount, unit: UNITS[id] ?? "g" },
    ]),
  );
}

function row(rows: NutritionFactsRow[], id: string): NutritionFactsRow {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row for nutrient ${id}`);
  return found;
}

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return { nutrientId: PROTEIN, operator: ">=", value: 150, period: "day", active: true, ...over };
}

describe("nutritionFactsLabel — row order and shape", () => {
  it("prints every mandatory row in the FDA's order, whatever the vector holds", () => {
    const full = nutritionFactsLabel(vector({ [CALORIES]: 500, [SODIUM]: 890 }));
    const sparse = nutritionFactsLabel(vector({}));

    const order = [
      CALORIES,
      FAT,
      SAT_FAT,
      TRANS_FAT,
      CHOLESTEROL,
      SODIUM,
      CARBS,
      FIBER,
      TOTAL_SUGARS,
      ADDED_SUGARS,
      PROTEIN,
      VITAMIN_D,
      CALCIUM,
      IRON,
      POTASSIUM,
    ];
    expect(full.map((r) => r.id)).toEqual(order);
    // The shape must not drift recipe to recipe — that is the specific way a
    // label stops reading as a label.
    expect(sparse.map((r) => r.id)).toEqual(order);
  });

  it("hangs saturated fat under fat and added sugars under total sugars", () => {
    const rows = nutritionFactsLabel(vector({}));
    expect(row(rows, FAT).indent).toBe(0);
    expect(row(rows, SAT_FAT).indent).toBe(1);
    expect(row(rows, TRANS_FAT).indent).toBe(1);
    expect(row(rows, FIBER).indent).toBe(1);
    expect(row(rows, TOTAL_SUGARS).indent).toBe(1);
    expect(row(rows, ADDED_SUGARS).indent).toBe(2);
  });

  it("groups calories, macros and micronutrients so the rules never move", () => {
    const rows = nutritionFactsLabel(vector({}));
    expect(row(rows, CALORIES).group).toBe("calories");
    expect(row(rows, PROTEIN).group).toBe("nutrient");
    expect(row(rows, VITAMIN_D).group).toBe("micronutrient");
    expect(row(rows, POTASSIUM).group).toBe("micronutrient");
  });
});

describe("nutritionFactsLabel — unmeasured nutrients", () => {
  it("reports a missing nutrient as null, never zero", () => {
    const rows = nutritionFactsLabel(vector({ [CALORIES]: 500 }));
    // Trans fat, added sugars and vitamin D are not in the estimator's seed.
    // A confident 0 g of trans fat on a panel that looks official is exactly
    // the lie this whole surface has to avoid.
    for (const id of [TRANS_FAT, ADDED_SUGARS, VITAMIN_D]) {
      expect(row(rows, id).amount).toBeNull();
      expect(row(rows, id).dvPercent).toBeNull();
      expect(row(rows, id).targetPercent).toBeNull();
    }
  });

  it("yields the full shape with nothing measured when there is no vector", () => {
    const rows = nutritionFactsLabel(undefined);
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => r.amount === null)).toBe(true);
  });
});

describe("nutritionFactsLabel — Daily Value arithmetic", () => {
  it("computes %DV against the FDA reference and rounds to a whole percent", () => {
    const rows = nutritionFactsLabel(vector({ [SODIUM]: 890 }));
    // 890 / 2300 = 38.7%
    expect(row(rows, SODIUM).dvPercent).toBe(39);
  });

  it("covers each nutrient that carries a Daily Value", () => {
    const rows = nutritionFactsLabel(
      vector({
        [FAT]: 39,
        [SAT_FAT]: 10,
        [CHOLESTEROL]: 150,
        [CARBS]: 55,
        [FIBER]: 7,
        [ADDED_SUGARS]: 25,
        [VITAMIN_D]: 10,
        [CALCIUM]: 130,
        [IRON]: 9,
        [POTASSIUM]: 470,
      }),
    );
    expect(row(rows, FAT).dvPercent).toBe(50);
    expect(row(rows, SAT_FAT).dvPercent).toBe(50);
    expect(row(rows, CHOLESTEROL).dvPercent).toBe(50);
    expect(row(rows, CARBS).dvPercent).toBe(20);
    expect(row(rows, FIBER).dvPercent).toBe(25);
    expect(row(rows, ADDED_SUGARS).dvPercent).toBe(50);
    expect(row(rows, VITAMIN_D).dvPercent).toBe(50);
    expect(row(rows, CALCIUM).dvPercent).toBe(10);
    expect(row(rows, IRON).dvPercent).toBe(50);
    expect(row(rows, POTASSIUM).dvPercent).toBe(10);
  });

  it("carries no %DV for calories, protein, trans fat or total sugars", () => {
    const rows = nutritionFactsLabel(
      vector({ [CALORIES]: 500, [PROTEIN]: 30, [TRANS_FAT]: 1, [TOTAL_SUGARS]: 12 }),
    );
    for (const id of [CALORIES, PROTEIN, TRANS_FAT, TOTAL_SUGARS]) {
      // Measured, and deliberately unscored — as on the real label.
      expect(row(rows, id).amount).not.toBeNull();
      expect(row(rows, id).dvPercent).toBeNull();
      expect(DAILY_VALUES[id]).toBeUndefined();
    }
  });

  it("separates 'has no Daily Value' from 'we did not measure it'", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 30 }));
    // Protein: measured, and no Daily Value exists — a blank cell, not a dash.
    expect(row(rows, PROTEIN).hasDailyValue).toBe(false);
    // Sodium: a Daily Value exists, but nothing was measured — the em-dash the
    // footnote defines.
    expect(row(rows, SODIUM).hasDailyValue).toBe(true);
    expect(row(rows, SODIUM).dvPercent).toBeNull();
  });

  it("refuses a %DV when the estimate's unit does not match the reference", () => {
    const rows = nutritionFactsLabel({
      [SODIUM]: { nutrientId: SODIUM, amount: 2.3, unit: "g" },
    });
    // 2.3 g is a whole day of sodium; against a 2,300 mg reference the naive
    // ratio prints 0%, which is worse than printing nothing.
    expect(row(rows, SODIUM).amount?.amount).toBe(2.3);
    expect(row(rows, SODIUM).dvPercent).toBeNull();
  });

  it("accepts mcg and µg as the same unit for vitamin D", () => {
    const rows = nutritionFactsLabel({
      [VITAMIN_D]: { nutrientId: VITAMIN_D, amount: 5, unit: "mcg" },
    });
    expect(row(rows, VITAMIN_D).dvPercent).toBe(25);
  });
});

describe("nutritionFactsLabel — divisor", () => {
  it("divides every amount and every percentage by the serving count", () => {
    const rows = nutritionFactsLabel(vector({ [CALORIES]: 2000, [SODIUM]: 4600 }), { divisor: 4 });
    expect(row(rows, CALORIES).amount?.amount).toBe(500);
    expect(row(rows, SODIUM).amount?.amount).toBe(1150);
    expect(row(rows, SODIUM).dvPercent).toBe(50);
  });

  it("treats the whole vector as one period when no divisor is given", () => {
    const rows = nutritionFactsLabel(vector({ [SODIUM]: 2300 }));
    expect(row(rows, SODIUM).dvPercent).toBe(100);
  });

  it("reports nothing measured rather than infinities for a non-positive divisor", () => {
    for (const divisor of [0, -2, Number.NaN]) {
      const rows = nutritionFactsLabel(vector({ [CALORIES]: 500 }), { divisor });
      expect(rows).toHaveLength(15);
      expect(rows.every((r) => r.amount === null)).toBe(true);
    }
  });
});

describe("nutritionFactsLabel — personal targets", () => {
  it("measures the same amount against the user's goal for that period", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60, [SODIUM]: 1150 }), {
      targets: [target({ nutrientId: PROTEIN, value: 150, period: "day" })],
      period: "day",
    });
    expect(row(rows, PROTEIN).targetPercent).toBe(40);
    // Untargeted nutrients keep their %DV and gain no personal figure.
    expect(row(rows, SODIUM).dvPercent).toBe(50);
    expect(row(rows, SODIUM).targetPercent).toBeNull();
  });

  it("works for a cap as readily as for a floor", () => {
    const rows = nutritionFactsLabel(vector({ [CHOLESTEROL]: 150 }), {
      targets: [target({ nutrientId: CHOLESTEROL, operator: "<=", value: 200, period: "day" })],
      period: "day",
    });
    expect(row(rows, CHOLESTEROL).targetPercent).toBe(75);
    // The standard figure survives beside the personal one: two users must
    // still see the same %DV for the same food.
    expect(row(rows, CHOLESTEROL).dvPercent).toBe(50);
  });

  it("ignores targets for another period", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60 }), {
      targets: [target({ value: 1050, period: "week" })],
      period: "day",
    });
    expect(row(rows, PROTEIN).targetPercent).toBeNull();
  });

  it("ignores inactive targets, so pausing a diet empties the column", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60 }), {
      targets: [target({ active: false })],
      period: "day",
    });
    expect(row(rows, PROTEIN).targetPercent).toBeNull();
    expect(hasTargetColumn(rows)).toBe(false);
  });

  it("ignores targets entirely when the caller names no period", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60 }), { targets: [target()] });
    expect(row(rows, PROTEIN).targetPercent).toBeNull();
  });

  it("scores a meal target against the per-serving amount, not the whole recipe", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 120 }), {
      divisor: 4,
      targets: [target({ value: 30, period: "meal" })],
      period: "meal",
    });
    expect(row(rows, PROTEIN).targetPercent).toBe(100);
  });

  it("skips a target of zero rather than dividing by it", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60 }), {
      targets: [target({ value: 0 })],
      period: "day",
    });
    expect(row(rows, PROTEIN).targetPercent).toBeNull();
  });
});

describe("hasTargetColumn", () => {
  it("is true as soon as one row carries a personal figure", () => {
    const rows = nutritionFactsLabel(vector({ [PROTEIN]: 60 }), {
      targets: [target()],
      period: "day",
    });
    expect(hasTargetColumn(rows)).toBe(true);
  });

  it("keeps the column for a goal we could not score, so the goal is not silently dropped", () => {
    const rows = nutritionFactsLabel(vector({ [CALORIES]: 500 }), {
      targets: [target({ nutrientId: PROTEIN })],
      period: "day",
    });
    expect(row(rows, PROTEIN).hasTarget).toBe(true);
    expect(row(rows, PROTEIN).targetPercent).toBeNull();
    expect(hasTargetColumn(rows)).toBe(true);
  });

  it("is false when no goal touches a nutrient the panel prints", () => {
    const rows = nutritionFactsLabel(vector({ [CALORIES]: 500, [PROTEIN]: 30 }), {
      // "1104" is vitamin A — a real nutrient, but not a row on this panel.
      targets: [target({ nutrientId: "1104" })],
      period: "day",
    });
    expect(hasTargetColumn(rows)).toBe(false);
  });
});
