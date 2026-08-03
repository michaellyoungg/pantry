import type { NutritionEstimate, NutritionRecipeCoverage } from "@pantry/types";
import { describe, expect, it } from "vitest";
import { NUTRITION_COVERAGE_THRESHOLD } from "./nutrition";
import { planNutritionSignature, rollUpWeekNutrition, summarizeNutrition } from "./nutritionRollup";

function recipe(over: Partial<NutritionRecipeCoverage> = {}): NutritionRecipeCoverage {
  return {
    recipeId: "r1",
    title: "Pancakes",
    multiplier: 1,
    counted: true,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ...over,
  };
}

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    nutrients: {
      "1008": { nutrientId: "1008", amount: 900, unit: "kcal" },
      "1003": { nutrientId: "1003", amount: 31.25, unit: "g" },
    },
    servings: 0,
    coverage: { resolvedMassFraction: 1, resolvedCount: 1, totalCount: 1 },
    ingredients: [{ item: "flour", grams: 125, resolved: true }],
    estimatedAt: "2026-08-03T12:00:00Z",
    recipes: [recipe()],
    ...over,
  };
}

describe("summarizeNutrition", () => {
  it("is empty when nothing was planned", () => {
    expect(summarizeNutrition(null)).toEqual({ kind: "empty" });
    expect(summarizeNutrition(undefined)).toEqual({ kind: "empty" });
  });

  it("is empty for an estimate with no food and no recipes", () => {
    const summary = summarizeNutrition(
      estimate({
        nutrients: {},
        ingredients: [],
        recipes: [],
        coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
      }),
    );
    expect(summary.kind).toBe("empty");
  });

  it("renders headline rows at full coverage", () => {
    const summary = summarizeNutrition(estimate());
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);

    expect(summary.rows).toEqual([
      { id: "1008", label: "Calories", value: "900 kcal" },
      { id: "1003", label: "Protein", value: "31.3 g" },
    ]);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.gaps.incomplete).toBe(false);
  });

  it("suppresses the figures below the coverage threshold and names the gap", () => {
    const summary = summarizeNutrition(
      estimate({
        coverage: { resolvedMassFraction: 0.5, resolvedCount: 1, totalCount: 2 },
        ingredients: [
          { item: "flour", grams: 125, resolved: true },
          { item: "saffron", grams: null, resolved: false, reason: "no gram weight" },
        ],
      }),
    );

    expect(summary.kind).toBe("unavailable");
    if (summary.kind !== "unavailable") return;
    expect(summary.coveragePercent).toBe(50);
    expect(summary.gaps.missingItems).toEqual(["saffron"]);
  });

  it("suppresses the figures when no headline nutrient survived", () => {
    const summary = summarizeNutrition(estimate({ nutrients: {} }));
    expect(summary.kind).toBe("unavailable");
  });

  // The failure this whole feature exists to prevent: a day whose dinner was
  // deleted must not read as a complete day.
  it("reports a recipe that could not be counted at all", () => {
    const summary = summarizeNutrition(
      estimate({
        recipes: [
          recipe(),
          recipe({
            recipeId: "gone",
            title: "",
            counted: false,
            coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
          }),
        ],
      }),
    );
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);

    // The mass fraction describes only the food it saw, so it still reads 100%.
    // That is precisely why the exclusion has to travel separately.
    expect(summary.coveragePercent).toBe(100);
    expect(summary.gaps.excludedRecipes).toEqual(["a removed recipe"]);
    expect(summary.gaps.incomplete).toBe(true);
  });

  it("names an excluded recipe when its title survived", () => {
    const summary = summarizeNutrition(
      estimate({ recipes: [recipe({ title: "Chili", counted: false })] }),
    );
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);
    expect(summary.gaps.excludedRecipes).toEqual(["Chili"]);
  });

  it("names a counted recipe that only partly resolved", () => {
    const summary = summarizeNutrition(
      estimate({
        recipes: [
          recipe({ title: "Pancakes" }),
          recipe({
            recipeId: "r2",
            title: "Curry",
            coverage: { resolvedMassFraction: 0.4, resolvedCount: 1, totalCount: 3 },
          }),
        ],
      }),
    );
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);
    expect(summary.gaps.partialRecipes).toEqual(["Curry"]);
    expect(summary.gaps.excludedRecipes).toEqual([]);
  });

  // An empty recipe has nothing to fail at; calling it "partial" would put a
  // permanent warning on a plan that is perfectly well understood.
  it("does not call an ingredient-less recipe partial", () => {
    const summary = summarizeNutrition(
      estimate({
        recipes: [
          recipe(),
          recipe({
            recipeId: "r2",
            title: "Water",
            coverage: { resolvedMassFraction: 0, resolvedCount: 0, totalCount: 0 },
          }),
        ],
      }),
    );
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);
    expect(summary.gaps.partialRecipes).toEqual([]);
  });

  it("de-duplicates an ingredient missing from several recipes", () => {
    const summary = summarizeNutrition(
      estimate({
        ingredients: [
          { item: "saffron", grams: null, resolved: false },
          { item: "saffron", grams: null, resolved: false },
          { item: "flour", grams: 125, resolved: true },
        ],
      }),
    );
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);
    expect(summary.gaps.missingItems).toEqual(["saffron"]);
  });

  it("divides by the supplied divisor", () => {
    const summary = summarizeNutrition(estimate(), 2);
    if (summary.kind !== "estimate") throw new Error(`expected an estimate, got ${summary.kind}`);
    expect(summary.rows[0]).toEqual({ id: "1008", label: "Calories", value: "450 kcal" });
  });

  it("treats the threshold as inclusive of the value itself", () => {
    const summary = summarizeNutrition(
      estimate({
        coverage: {
          resolvedMassFraction: NUTRITION_COVERAGE_THRESHOLD,
          resolvedCount: 4,
          totalCount: 5,
        },
      }),
    );
    expect(summary.kind).toBe("estimate");
  });
});

describe("rollUpWeekNutrition", () => {
  it("lays the days out Mon…Sun and leaves unplanned days empty", () => {
    const rollup = rollUpWeekNutrition({
      days: [{ weekday: 2, estimate: estimate() }],
      week: estimate(),
    });

    expect(rollup.days).toHaveLength(7);
    expect(rollup.days.map((d) => d.label)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(rollup.days[2].fullLabel).toBe("Wednesday");
    expect(rollup.days[2].summary.kind).toBe("estimate");
    expect(rollup.days[0].summary.kind).toBe("empty");
    expect(rollup.plannedDays).toBe(1);
  });

  it("averages the week across the days that had food, not across seven", () => {
    const week = estimate({
      nutrients: { "1008": { nutrientId: "1008", amount: 4000, unit: "kcal" } },
    });
    const rollup = rollUpWeekNutrition({
      days: [
        { weekday: 0, estimate: estimate() },
        { weekday: 1, estimate: estimate() },
      ],
      week,
    });

    expect(rollup.plannedDays).toBe(2);
    expect(rollup.dailyAverage).toEqual([{ id: "1008", label: "Calories", value: "2000 kcal" }]);
  });

  // A day we could not put a number on is still a planned day: it counts toward
  // the divisor, because its food is in the week total.
  it("counts an unavailable day as planned", () => {
    const rollup = rollUpWeekNutrition({
      days: [
        { weekday: 0, estimate: estimate() },
        {
          weekday: 1,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.2, resolvedCount: 1, totalCount: 4 },
          }),
        },
      ],
      week: estimate({
        nutrients: { "1008": { nutrientId: "1008", amount: 3000, unit: "kcal" } },
      }),
    });

    expect(rollup.days[1].summary.kind).toBe("unavailable");
    expect(rollup.plannedDays).toBe(2);
    expect(rollup.dailyAverage[0].value).toBe("1500 kcal");
  });

  it("offers no daily average when the week itself is not showable", () => {
    const rollup = rollUpWeekNutrition({
      days: [
        {
          weekday: 0,
          estimate: estimate({
            coverage: { resolvedMassFraction: 0.1, resolvedCount: 1, totalCount: 9 },
          }),
        },
      ],
      week: estimate({ coverage: { resolvedMassFraction: 0.1, resolvedCount: 1, totalCount: 9 } }),
    });

    expect(rollup.week.kind).toBe("unavailable");
    expect(rollup.dailyAverage).toEqual([]);
  });

  it("handles an empty plan", () => {
    const rollup = rollUpWeekNutrition({ days: [], week: null });
    expect(rollup.plannedDays).toBe(0);
    expect(rollup.week).toEqual({ kind: "empty" });
    expect(rollup.dailyAverage).toEqual([]);
    expect(rollup.days.every((d) => d.summary.kind === "empty")).toBe(true);
  });
});

describe("planNutritionSignature", () => {
  const item = (over: Partial<Parameters<typeof planNutritionSignature>[0][number]> = {}) => ({
    _id: "b1",
    recipeId: "r1",
    title: "Pancakes",
    weekday: 0,
    ...over,
  });

  it("changes when a recipe moves day or its servings dial moves", () => {
    const base = planNutritionSignature([item()]);
    expect(planNutritionSignature([item({ weekday: 3 })])).not.toBe(base);
    expect(planNutritionSignature([item({ servingsMultiplier: 2 })])).not.toBe(base);
  });

  // Leftovers are eaten, so the meal/leftover toggle moves the grocery list and
  // leaves nutrition exactly where it was.
  it("does not change when a meal becomes a leftover", () => {
    expect(planNutritionSignature([item({ type: "leftover" })])).toBe(
      planNutritionSignature([item({ type: "meal" })]),
    );
  });

  it("ignores entries that are not on a day", () => {
    expect(
      planNutritionSignature([item(), item({ _id: "b2", recipeId: "r2", weekday: undefined })]),
    ).toBe(planNutritionSignature([item()]));
  });

  it("does not depend on the order the basket happened to arrive in", () => {
    const a = item();
    const b = item({ _id: "b2", recipeId: "r2", weekday: 4 });
    expect(planNutritionSignature([a, b])).toBe(planNutritionSignature([b, a]));
  });
});
