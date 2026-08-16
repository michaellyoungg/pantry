import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { GroceryRow, type GroceryRowLine } from "./GroceryRow";
import { ROW_PRESS_RETENTION, ROW_TARGET_HEIGHT } from "./hitTargets";

const onToggle = jest.fn();
const onOpenSources = jest.fn();
const onRemove = jest.fn();
const onNeedItAnyway = jest.fn();

function row(over: Partial<GroceryRowLine> = {}) {
  const line: GroceryRowLine = {
    _id: "g1",
    item: "Parsley",
    unit: "tbsp",
    quantity: 2,
    checked: false,
    ...over,
  };
  return render(
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

describe("GroceryRow — one-handed check-off", () => {
  it("makes the whole row the check-off target, not just a checkbox", () => {
    row();
    fireEvent.press(screen.getByTestId("list.toggle.parsley"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("unticks an already-ticked line, so a mis-tap costs exactly one more tap", () => {
    row({ checked: true });
    fireEvent.press(screen.getByTestId("list.toggle.parsley"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("sizes that target for a thumb rather than for the accessibility floor", () => {
    row();
    const target = screen.getByTestId("list.toggle.parsley");
    expect(target.props.style).toEqual(expect.objectContaining({ minHeight: ROW_TARGET_HEIGHT }));
  });

  it("tolerates a hand that drifts off the row mid-press", () => {
    // Pressable consumes `pressRetentionOffset` into its responder config
    // rather than forwarding it to the host view, so the composite element is
    // the only place it can be observed.
    row();
    const [pressable] = screen.UNSAFE_getAllByProps({ testID: "list.toggle.parsley" });
    expect(pressable.props.pressRetentionOffset).toEqual(ROW_PRESS_RETENTION);
  });

  it("keeps every secondary action outside the check-off target", () => {
    // The interaction rule this screen is built on: a mis-aim in a shop must
    // land on the action that undoes itself, never on remove or a sheet.
    row({
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

  it("grows the small chips' touch area past their ink", () => {
    row({ sources: [{ recipeId: "r1", title: "Soup", quantity: 2 }] });
    expect(screen.getByTestId("list.provenance.parsley").props.hitSlop.top).toBeGreaterThan(0);
  });
});

describe("GroceryRow — what it says", () => {
  it("leads with what the shop sells, and keeps the recipes' measure beside it", () => {
    row({ purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" } });

    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("1 bunch Parsley");
    expect(screen.getByTestId("list.need.parsley")).toHaveTextContent("needs 2 tbsp");
  });

  it("says the need only when it differs from the pack", () => {
    row();
    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("2 tbsp Parsley");
    expect(screen.queryByTestId("list.need.parsley")).toBeNull();
  });

  it("pluralizes the pack the way every client does", () => {
    row({ quantity: 4, purchase: { quantity: 2, unit: "bunch" } });
    expect(screen.getByTestId("list.buy.parsley")).toHaveTextContent("2 bunches Parsley");
  });

  it("counts the recipes a merged line came from", () => {
    row({
      sources: [
        { recipeId: "r1", title: "Soup", quantity: 1 },
        { recipeId: "r2", title: "Salad", quantity: 1 },
      ],
    });
    fireEvent.press(screen.getByTestId("list.provenance.parsley"));

    expect(screen.getByTestId("list.provenance.parsley")).toHaveTextContent("2 recipes");
    expect(onOpenSources).toHaveBeenCalled();
  });

  it("offers no provenance at all for a line with no traceable source", () => {
    row();
    expect(screen.queryByTestId("list.provenance.parsley")).toBeNull();
  });

  it("flags a line the pantry already covers, and offers a way past it", () => {
    row({ alreadyHave: true });
    expect(screen.getByTestId("list.already-have.parsley")).toBeTruthy();

    fireEvent.press(screen.getByTestId("list.need-it-anyway.parsley"));
    expect(onNeedItAnyway).toHaveBeenCalled();
  });

  it("offers no remove on a generated line, which would come back anyway", () => {
    row();
    expect(screen.queryByTestId("list.remove.parsley")).toBeNull();
  });

  it("removes a manual line, which is the shopper's own to take back", () => {
    row({ manual: true });
    fireEvent.press(screen.getByTestId("list.remove.parsley"));
    expect(onRemove).toHaveBeenCalled();
  });
});
