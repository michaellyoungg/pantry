import { describe, expect, it } from "vitest";
import {
  changedLineIds,
  groupByAisle,
  partitionCart,
  partitionRemoved,
  pluralizeUnit,
  purchaseText,
  residueText,
  SWIPE_COMMIT_PX,
  SWIPE_MAX_PX,
  SWIPE_SLOP_PX,
  titleCase,
  trackSwipe,
} from "./grocery";

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

describe("pluralizeUnit", () => {
  it("leaves a single pack singular", () => {
    expect(pluralizeUnit("bunch", 1)).toBe("bunch");
  });

  it("takes -es after a sibilant", () => {
    expect(pluralizeUnit("bunch", 2)).toBe("bunches");
    expect(pluralizeUnit("box", 2)).toBe("boxes");
  });

  it("takes a plain -s otherwise", () => {
    expect(pluralizeUnit("can", 3)).toBe("cans");
    expect(pluralizeUnit("quart", 2)).toBe("quarts");
  });

  it("pluralizes a fractional count, which is not one pack", () => {
    expect(pluralizeUnit("bunch", 1.5)).toBe("bunches");
  });

  it("leaves an empty unit empty rather than inventing an 's'", () => {
    expect(pluralizeUnit("", 3)).toBe("");
  });
});

describe("purchaseText", () => {
  const fmt = (n: number) => String(n);

  it("says what the shop sells, and what the recipes wanted", () => {
    expect(
      purchaseText({ quantity: 2, unit: "tbsp", purchase: { quantity: 1, unit: "bunch" } }, fmt),
    ).toEqual({ buy: "1 bunch", need: "2 tbsp" });
  });

  it("falls back to the recipe's own measure with no pack data", () => {
    expect(purchaseText({ quantity: 3, unit: "cloves" }, fmt)).toEqual({ buy: "3 cloves" });
  });

  it("drops the empty unit an unquantified line carries", () => {
    expect(purchaseText({ quantity: 2, unit: "" }, fmt)).toEqual({ buy: "2" });
  });
});

describe("residueText", () => {
  const fmt = (n: number) => String(n);

  it("names the surplus", () => {
    expect(residueText({ quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" }, fmt)).toBe(
      "6 tbsp",
    );
  });

  it("is empty when the pack was an exact fit", () => {
    expect(residueText({ quantity: 1, unit: "bunch" }, fmt)).toBe("");
  });
});

describe("partitionCart", () => {
  const cartLine = (item: string, checked: boolean) => ({ item, checked });

  it("keeps what is still to buy apart from what is already in the cart", () => {
    const lines = [cartLine("milk", false), cartLine("eggs", true), cartLine("kale", false)];
    expect(partitionCart(lines)).toEqual({
      toBuy: [cartLine("milk", false), cartLine("kale", false)],
      inCart: [cartLine("eggs", true)],
    });
  });

  it("preserves the server's aisle order inside each half", () => {
    const lines = [cartLine("a", true), cartLine("b", true), cartLine("c", true)];
    expect(partitionCart(lines).inCart.map((l) => l.item)).toEqual(["a", "b", "c"]);
  });

  it("lets the caller hold a line back while it animates across", () => {
    const ticked = { item: "eggs", checked: true };
    const { toBuy, inCart } = partitionCart([ticked], (l) => l.checked && l.item !== "eggs");
    expect(toBuy).toEqual([ticked]);
    expect(inCart).toEqual([]);
  });

  it("gives an untouched list nothing in the cart", () => {
    expect(partitionCart([cartLine("milk", false)])).toEqual({
      toBuy: [cartLine("milk", false)],
      inCart: [],
    });
  });
});

describe("trackSwipe", () => {
  it("ignores movement inside the slop, so an ordinary tap does not slide", () => {
    expect(trackSwipe(-(SWIPE_SLOP_PX - 1), 0)).toEqual({
      offset: 0,
      engaged: false,
      willDelete: false,
    });
  });

  it("tracks a leftward drag past the slop", () => {
    const state = trackSwipe(-40, 2);
    expect(state.engaged).toBe(true);
    expect(state.offset).toBe(-40);
    expect(state.willDelete).toBe(false);
  });

  it("commits once the row has travelled far enough", () => {
    expect(trackSwipe(-SWIPE_COMMIT_PX, 0).willDelete).toBe(true);
  });

  it("clamps the offset so the row never leaves the screen", () => {
    expect(trackSwipe(-500, 0).offset).toBe(-SWIPE_MAX_PX);
  });

  it("yields to a vertical drag, which is the page being scrolled", () => {
    expect(trackSwipe(-40, 80)).toEqual({ offset: 0, engaged: false, willDelete: false });
  });

  it("does nothing rightward — one direction, one meaning", () => {
    expect(trackSwipe(60, 0)).toEqual({ offset: 0, engaged: true, willDelete: false });
  });
});

describe("changedLineIds", () => {
  const l = (id: string, checked = false, quantity = 1) => ({ _id: id, checked, quantity });

  it("reports a line another shopper ticked off", () => {
    expect(changedLineIds([l("a"), l("b")], [l("a"), l("b", true)])).toEqual(["b"]);
  });

  it("reports a quantity another device changed", () => {
    expect(changedLineIds([l("a")], [l("a", false, 3)])).toEqual(["a"]);
  });

  it("reports a line that appeared out of nowhere", () => {
    expect(changedLineIds([l("a")], [l("a"), l("new")])).toEqual(["new"]);
  });

  it("says nothing when nothing moved", () => {
    expect(changedLineIds([l("a"), l("b", true)], [l("a"), l("b", true)])).toEqual([]);
  });

  it("cannot highlight a line that has gone away", () => {
    expect(changedLineIds([l("a"), l("b")], [l("a")])).toEqual([]);
  });
});
