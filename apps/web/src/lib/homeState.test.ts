import { describe, expect, it } from "vitest";
import { type BasketRow, countMeals, deriveHomeState, type GroceryRow } from "./homeState";

function meal(id: string, over: Partial<BasketRow> = {}): BasketRow {
  return { _id: id, recipeId: `r-${id}`, title: `Recipe ${id}`, ...over };
}

function line(id: string, checked: boolean): GroceryRow {
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

  // Nothing clears a finished list, so `shopped` must carry enough context for the
  // UI to offer a way onward — otherwise Home dead-ends there week after week.
  it("carries the meal count into shopped so rebuilding stays reachable", () => {
    const basket = [meal("a"), meal("b"), meal("c", { type: "leftover" })];
    expect(deriveHomeState(basket, [line("1", true)])).toEqual({
      kind: "shopped",
      total: 1,
      mealCount: 2,
    });
  });

  it("reports no meals to rebuild when the plan is empty", () => {
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
