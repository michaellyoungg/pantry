import { describe, expect, it } from "vitest";
import { groupByAisle, partitionRemoved, titleCase } from "./grocery";

const line = (aisle: string, item: string) => ({ aisle, item });

describe("groupByAisle", () => {
  it("groups consecutive runs and keeps server order", () => {
    const groups = groupByAisle([
      line("produce", "onion"),
      line("produce", "garlic"),
      line("dairy", "milk"),
    ]);
    expect(groups.map((g) => g.aisle)).toEqual(["produce", "dairy"]);
    expect(groups[0].lines.map((l) => l.item)).toEqual(["onion", "garlic"]);
    expect(groups[1].lines.map((l) => l.item)).toEqual(["milk"]);
  });

  it("returns no groups for no lines", () => {
    expect(groupByAisle([])).toEqual([]);
  });

  it("opens a second group when an aisle reappears out of run", () => {
    // The server sorts by aisle, so this shouldn't happen; if it does, the walk
    // order the server chose still wins over folding the rows back together.
    const groups = groupByAisle([
      line("produce", "onion"),
      line("dairy", "milk"),
      line("produce", "kale"),
    ]);
    expect(groups.map((g) => g.aisle)).toEqual(["produce", "dairy", "produce"]);
  });
});

describe("titleCase", () => {
  it("capitalises the first letter", () => {
    expect(titleCase("produce")).toBe("Produce");
  });

  it("leaves an empty string alone", () => {
    expect(titleCase("")).toBe("");
  });

  it("does not lowercase the rest", () => {
    expect(titleCase("dairy & eggs")).toBe("Dairy & eggs");
  });
});

describe("partitionRemoved", () => {
  type Line = { item: string; removed?: boolean };
  const milk: Line = { item: "milk" };
  const kale: Line = { item: "kale", removed: true };

  it("splits the shopping list from the lines the plan dropped", () => {
    const { active, removed } = partitionRemoved([milk, kale]);
    expect(active).toEqual([milk]);
    expect(removed).toEqual([kale]);
  });

  it("keeps server order within each half", () => {
    const bread: Line = { item: "bread" };
    const eggs: Line = { item: "eggs", removed: true };
    const { active, removed } = partitionRemoved([kale, milk, eggs, bread]);
    expect(active.map((l) => l.item)).toEqual(["milk", "bread"]);
    expect(removed.map((l) => l.item)).toEqual(["kale", "eggs"]);
  });

  it("treats an explicit false the same as an absent flag", () => {
    const { active, removed } = partitionRemoved<Line>([{ item: "milk", removed: false }]);
    expect(active).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });
});
