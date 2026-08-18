import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { GroceryRow, type GroceryRowLine } from "./GroceryRow";
import { ROW_TARGET_HEIGHT } from "./hitTargets";

const onToggle = jest.fn();
const onOpenSources = jest.fn();
const onRemove = jest.fn();
const onNeedItAnyway = jest.fn();

async function row(over: Partial<GroceryRowLine> = {}) {
  const line: GroceryRowLine = {
    _id: "g1",
    item: "Parsley",
    unit: "tbsp",
    quantity: 2,
    checked: false,
    ...over,
  };
  return await render(
    <GroceryRow
      line={line}
      onNeedItAnyway={onNeedItAnyway}
      onOpenSources={onOpenSources}
      onRemove={line.manual ? onRemove : undefined}
      onToggle={onToggle}
    />,
  );
}

beforeEach(() => jest.clearAllMocks());

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles. Dropping an `await`
// does not fail loudly — the next line throws ``render` function has not been
// called``, which reads like the component never mounted.

describe("GroceryRow — one-handed check-off", () => {
  it("makes the whole row the check-off target, not just a checkbox", async () => {
    await row();
    await fireEvent.press(screen.getByTestId("list.toggle.parsley"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("unticks an already-ticked line, so a mis-tap costs exactly one more tap", async () => {
    await row({ checked: true });
    await fireEvent.press(screen.getByTestId("list.toggle.parsley"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("sizes that target for a thumb rather than for the accessibility floor", async () => {
    // This stands in for the press-retention offset too. Pressable swallows
    // that one into its responder config and RNTL 14 removed the queries that
    // could reach it, so the two travel in one object (ROW_PRESS_PROPS) — a row
    // that stopped applying it would fail this height assertion first.
    await row();
    const target = screen.getByTestId("list.toggle.parsley");
    expect(target.props.style).toEqual(expect.objectContaining({ minHeight: ROW_TARGET_HEIGHT }));
  });

  it("keeps every secondary action outside the check-off target", async () => {
    // The interaction rule this screen is built on: a mis-aim in a shop must
    // land on the action that undoes itself, never on remove or a sheet.
    await row({
      manual: true,
      alreadyHave: true,
      sources: [{ recipeId: "r1", title: "Soup", quantity: 2 }],
    });
    const toggle = screen.getByTestId("list.toggle.parsley");

    for (const chip of [
      "list.provenance.parsley",
      "list.remove.parsley",
      "list.need-it-anyway.parsley",
    ]) {
      expect(screen.getByTestId(chip)).toBeTruthy();
      expect(within(toggle).queryByTestId(chip)).toBeNull();
    }
  });

  it("grows the small chips' touch area past their ink", async () => {
    await row({ sources: [{ recipeId: "r1", title: "Soup", quantity: 2 }] });
    expect(screen.getByTestId("list.provenance.parsley").props.hitSlop.top).toBeGreaterThan(0);
  });
});

describe("GroceryRow — what it says", () => {
  it("leads with what the shop sells, and keeps the recipes' measure beside it", async () => {
    await row({ purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" } });

    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("1 bunch Parsley");
    expect(screen.getByTestId("list.need.parsley")).toHaveTextContent("needs 2 tbsp");
  });

  it("says the need only when it differs from the pack", async () => {
    await row();
    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("2 tbsp Parsley");
    expect(screen.queryByTestId("list.need.parsley")).toBeNull();
  });

  it("pluralizes the pack the way every client does", async () => {
    await row({ quantity: 4, purchase: { quantity: 2, unit: "bunch" } });
    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("2 bunches Parsley");
  });

  it("counts the recipes a merged line came from", async () => {
    await row({
      sources: [
        { recipeId: "r1", title: "Soup", quantity: 1 },
        { recipeId: "r2", title: "Salad", quantity: 1 },
      ],
    });
    await fireEvent.press(screen.getByTestId("list.provenance.parsley"));

    expect(screen.getByTestId("list.provenance.parsley")).toHaveTextContent("2 recipes");
    expect(onOpenSources).toHaveBeenCalled();
  });

  it("offers no provenance at all for a line with no traceable source", async () => {
    await row();
    expect(screen.queryByTestId("list.provenance.parsley")).toBeNull();
  });

  it("flags a line the pantry already covers, and offers a way past it", async () => {
    await row({ alreadyHave: true });
    expect(screen.getByTestId("list.already-have.parsley")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("list.need-it-anyway.parsley"));
    expect(onNeedItAnyway).toHaveBeenCalled();
  });

  it("offers no remove on a generated line, which would come back anyway", async () => {
    await row();
    expect(screen.queryByTestId("list.remove.parsley")).toBeNull();
  });

  it("removes a manual line, which is the shopper's own to take back", async () => {
    await row({ manual: true });
    await fireEvent.press(screen.getByTestId("list.remove.parsley"));
    expect(onRemove).toHaveBeenCalled();
  });
});
