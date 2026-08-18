import { describe, expect, it } from "vitest";
import { countMeals, deriveHomeState, type HomeGroceryLine } from "./home";
import type { PlannedItem } from "./planner";

/** A list row as the server stores it — richer than Home reads, on purpose. */
type Line = HomeGroceryLine & { _id: string; item: string };

function meal(id: string, over: Partial<PlannedItem> = {}): PlannedItem {
  return { _id: id, recipeId: `r-${id}`, title: `Recipe ${id}`, ...over };
}

function line(id: string, checked: boolean): Line {
  return { _id: id, item: `item-${id}`, checked };
}

describe("deriveHomeState", () => {
  it("is loading until both queries resolve", () => {
    expect(deriveHomeState(undefined, [])).toEqual({ kind: "loading" });
    expect(deriveHomeState([], undefined)).toEqual({ kind: "loading" });
    expect(deriveHomeState(undefined, undefined)).toEqual({ kind: "loading" });
  });

  it("is empty with no plan and no list", () => {
    expect(deriveHomeState([], [])).toEqual({ kind: "empty" });
  });

  it("is planned once the week has meals but no list exists", () => {
    expect(deriveHomeState([meal("a"), meal("b")], [])).toEqual({ kind: "planned", mealCount: 2 });
  });

  it("counts only meals, not leftovers, because leftovers generate no lines", () => {
    const basket = [meal("a"), meal("b", { type: "leftover" })];
    expect(deriveHomeState(basket, [])).toEqual({ kind: "planned", mealCount: 1 });
  });

  it("is empty when the plan holds nothing but leftovers", () => {
    expect(deriveHomeState([meal("a", { type: "leftover" })], [])).toEqual({ kind: "empty" });
  });

  it("is shopping while any line is unchecked", () => {
    const list = [line("1", true), line("2", false), line("3", false)];
    expect(deriveHomeState([meal("a")], list)).toEqual({
      kind: "shopping",
      total: 3,
      checked: 1,
      remaining: 2,
    });
  });

  it("is shopped once every line is checked", () => {
    const list = [line("1", true), line("2", true)];
    expect(deriveHomeState([meal("a")], list)).toEqual({
      kind: "shopped",
      total: 2,
      mealCount: 1,
    });
  });

  // Nothing clears a fully-checked list, so it survives into the next week's planning.
  // The state must carry the meal count or Home has no way back to building a list.
  it("reports the plan's meal count while shopped, so the build path stays reachable", () => {
    const list = [line("1", true)];
    expect(deriveHomeState([meal("a"), meal("b"), meal("c")], list)).toEqual({
      kind: "shopped",
      total: 1,
      mealCount: 3,
    });
  });

  it("reports zero meals when shopped with an empty plan", () => {
    expect(deriveHomeState([], [line("1", true)])).toEqual({
      kind: "shopped",
      total: 1,
      mealCount: 0,
    });
  });

  it("keeps the shopping handoff when the plan is cleared mid-shop", () => {
    expect(deriveHomeState([], [line("1", false)])).toEqual({
      kind: "shopping",
      total: 1,
      checked: 0,
      remaining: 1,
    });
  });
});

describe("countMeals", () => {
  it("treats a missing type as a meal", () => {
    expect(countMeals([meal("a"), meal("b", { type: "meal" })])).toBe(2);
  });
});

describe("lines the plan has dropped (BL-0018)", () => {
  const removedLine = (id: string): Line => ({
    _id: id,
    item: `item-${id}`,
    checked: true,
    removed: true,
  });

  it("does not count a flagged line among the things left to buy", () => {
    // The shopper already has it in the cart and the plan no longer wants it;
    // counting it would overstate both the list and the shopping progress.
    const list = [line("1", false), removedLine("2")];
    expect(deriveHomeState([meal("a")], list)).toEqual({
      kind: "shopping",
      total: 1,
      checked: 0,
      remaining: 1,
    });
  });

  it("is shopped when every line that still counts is checked", () => {
    const list = [line("1", true), removedLine("2")];
    expect(deriveHomeState([meal("a")], list)).toEqual({
      kind: "shopped",
      total: 1,
      mealCount: 1,
    });
  });

  it("offers the next plan when nothing but flagged lines remain", () => {
    expect(deriveHomeState([meal("a")], [removedLine("1")])).toEqual({
      kind: "planned",
      mealCount: 1,
    });
  });
});
