import { describe, expect, it } from "vitest";
import { planItemsForWeek } from "./weekFilter";

const base = (o: Record<string, unknown>) => ({
  recipeId: "r",
  title: "x",
  servingsMultiplier: 1,
  type: "meal" as const,
  ...o,
});

describe("planItemsForWeek", () => {
  it("keeps meals within the Sun–Sat week, dropping leftovers/unscheduled/other weeks", () => {
    const items = planItemsForWeek(
      [
        base({ recipeId: "in", plannedDate: "2026-07-14", servingsMultiplier: 2 }),
        base({ recipeId: "sun", plannedDate: "2026-07-12" }),
        base({ recipeId: "sat", plannedDate: "2026-07-18" }),
        base({ recipeId: "next", plannedDate: "2026-07-19" }),
        base({ recipeId: "leftover", plannedDate: "2026-07-14", type: "leftover" }),
        base({ recipeId: "unscheduled" }),
      ],
      "2026-07-12",
    );
    expect(items).toEqual([
      { recipeId: "in", multiplier: 2 },
      { recipeId: "sun", multiplier: 1 },
      { recipeId: "sat", multiplier: 1 },
    ]);
  });
});
