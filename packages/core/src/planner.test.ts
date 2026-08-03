import { describe, expect, it } from "vitest";
import {
  canGenerateList,
  decreaseServings,
  defaultServingsMultiplier,
  increaseServings,
  isCooked,
  isLeftover,
  MIN_SERVINGS_MULTIPLIER,
  type PlannedItem,
  planWeek,
  servingsMultiplier,
  toggledType,
  unscheduledItems,
} from "./planner";

const item = (over: Partial<PlannedItem> & { _id: string }): PlannedItem => ({
  recipeId: `r-${over._id}`,
  title: `Recipe ${over._id}`,
  ...over,
});

describe("planWeek", () => {
  it("returns seven days in Mon…Sun order with labels", () => {
    const days = planWeek([]);
    expect(days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days[0].fullLabel).toBe("Monday");
    expect(days[6].fullLabel).toBe("Sunday");
  });

  it("buckets entries onto their weekday and leaves the rest empty", () => {
    const days = planWeek([
      item({ _id: "a", weekday: 0 }),
      item({ _id: "b", weekday: 2 }),
      item({ _id: "c", weekday: 0 }),
      item({ _id: "d" }),
    ]);
    expect(days[0].items.map((i) => i._id)).toEqual(["a", "c"]);
    expect(days[2].items.map((i) => i._id)).toEqual(["b"]);
    expect(days[1].items).toEqual([]);
    // An unscheduled entry lands on no day at all.
    expect(days.flatMap((d) => d.items).map((i) => i._id)).not.toContain("d");
  });

  it("preserves input order within a day", () => {
    const days = planWeek([
      item({ _id: "second", weekday: 3 }),
      item({ _id: "first", weekday: 3 }),
    ]);
    expect(days[3].items.map((i) => i._id)).toEqual(["second", "first"]);
  });
});

describe("unscheduledItems", () => {
  it("keeps only entries without a weekday", () => {
    const items = [item({ _id: "a", weekday: 0 }), item({ _id: "b" }), item({ _id: "c" })];
    expect(unscheduledItems(items).map((i) => i._id)).toEqual(["b", "c"]);
  });

  it("treats weekday 0 as scheduled, not as falsy", () => {
    expect(unscheduledItems([item({ _id: "mon", weekday: 0 })])).toEqual([]);
  });
});

describe("servings", () => {
  it("defaults an unset multiplier to a single batch", () => {
    expect(servingsMultiplier(item({ _id: "a" }))).toBe(1);
    expect(servingsMultiplier(item({ _id: "a", servingsMultiplier: 2 }))).toBe(2);
  });

  it("steps by a half batch", () => {
    expect(increaseServings(1)).toBe(1.5);
    expect(decreaseServings(1.5)).toBe(1);
  });

  it("clamps the decrease at a quarter batch", () => {
    expect(decreaseServings(0.5)).toBe(MIN_SERVINGS_MULTIPLIER);
    expect(decreaseServings(MIN_SERVINGS_MULTIPLIER)).toBe(MIN_SERVINGS_MULTIPLIER);
  });

  it("does not clamp the increase", () => {
    expect(increaseServings(10)).toBe(10.5);
  });
});

describe("meal / leftover", () => {
  it("reads the leftover flag", () => {
    expect(isLeftover(item({ _id: "a", type: "leftover" }))).toBe(true);
    expect(isLeftover(item({ _id: "a", type: "meal" }))).toBe(false);
    // Absent type means a meal.
    expect(isLeftover(item({ _id: "a" }))).toBe(false);
  });

  it("toggles between meal and leftover", () => {
    expect(toggledType(item({ _id: "a" }))).toBe("leftover");
    expect(toggledType(item({ _id: "a", type: "leftover" }))).toBe("meal");
  });
});

describe("canGenerateList", () => {
  it("is false only for an empty basket", () => {
    expect(canGenerateList([])).toBe(false);
    expect(canGenerateList([item({ _id: "a" })])).toBe(true);
  });
});

describe("isCooked", () => {
  it("is the presence of a cookedAt timestamp", () => {
    expect(isCooked({ _id: "b1", recipeId: "r1", title: "Toast" })).toBe(false);
    expect(isCooked({ _id: "b1", recipeId: "r1", title: "Toast", cookedAt: 0 })).toBe(true);
  });
});

describe("defaultServingsMultiplier", () => {
  it("is a single batch when the recipe already feeds the household", () => {
    expect(defaultServingsMultiplier(4, 4)).toBe(1);
  });

  it("doubles a recipe that feeds half the household", () => {
    expect(defaultServingsMultiplier(4, 2)).toBe(2);
  });

  it("halves a recipe that feeds twice the household", () => {
    expect(defaultServingsMultiplier(2, 4)).toBe(0.5);
  });

  it("snaps to the step the stepper moves in, rounding up on a tie", () => {
    // 5/4 = 1.25 — exactly between the 1.0 and 1.5 the stepper offers. Round up:
    // on a grocery list, buying slightly too much beats not being able to cook.
    expect(defaultServingsMultiplier(5, 4)).toBe(1.5);
  });

  it("never proposes less than the floor the stepper clamps to", () => {
    expect(defaultServingsMultiplier(1, 12)).toBe(MIN_SERVINGS_MULTIPLIER);
  });

  it("derives nothing when the recipe's yield is unknown", () => {
    // BL-0035 made servings nullable, and it usually is. Scaling by a guessed
    // yield would be worse than not scaling at all — and leaving the dial unset
    // is exactly how the planner already spells "one batch".
    expect(defaultServingsMultiplier(4, undefined)).toBeUndefined();
  });

  it("derives nothing when the household size is unset", () => {
    expect(defaultServingsMultiplier(undefined, 2)).toBeUndefined();
  });

  it("ignores nonsensical values rather than dividing by them", () => {
    expect(defaultServingsMultiplier(4, 0)).toBeUndefined();
    expect(defaultServingsMultiplier(0, 4)).toBeUndefined();
    expect(defaultServingsMultiplier(-2, 4)).toBeUndefined();
  });
});
