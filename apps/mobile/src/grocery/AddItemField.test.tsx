import { fireEvent, render, screen } from "@testing-library/react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { AddItemField } from "./AddItemField";

const onAdd = jest.fn();

beforeEach(() => jest.clearAllMocks());

// RNTL 14 made `render` and `fireEvent` async: they await React 19's `act`
// internally, and `screen` is only bound once that settles. Dropping an `await`
// does not fail loudly — the next line throws ``render` function has not been
// called``, which reads like the component never mounted.

describe("AddItemField", () => {
  it("hands over the raw text, unparsed — splitting it is the data layer's job", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);

    await fireEvent.changeText(screen.getByTestId("list.add-field"), "2 lb butter");
    await fireEvent.press(screen.getByTestId("list.add-submit"));

    expect(onAdd).toHaveBeenCalledWith("2 lb butter");
  });

  it("submits from the keyboard, so adding never needs a reach for the button", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);

    await fireEvent.changeText(screen.getByTestId("list.add-field"), "foil");
    await fireEvent(screen.getByTestId("list.add-field"), "submitEditing");

    expect(onAdd).toHaveBeenCalledWith("foil");
  });

  it("clears itself immediately, so a second add never looks like a duplicate", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);

    await fireEvent.changeText(screen.getByTestId("list.add-field"), "foil");
    await fireEvent.press(screen.getByTestId("list.add-submit"));

    expect(screen.getByTestId("list.add-field").props.value).toBe("");
  });

  it("cannot be submitted empty", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);

    expect(screen.getByTestId("list.add-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("list.add-submit"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers what the household buys as one-tap chips — no typing at all", async () => {
    await render(
      <AddItemField onAdd={onAdd} recent={[{ canonicalItem: "milk", display: "Whole Milk" }]} />,
    );

    await fireEvent.press(screen.getByTestId("list.add-suggestion.whole-milk"));

    expect(onAdd).toHaveBeenCalledWith("Whole Milk");
  });

  it("shows no chip row when there is nothing to suggest", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);
    expect(screen.queryByTestId("list.add-suggestion.whole-milk")).toBeNull();
  });

  it("keeps the field and its button hittable while standing", async () => {
    await render(<AddItemField onAdd={onAdd} recent={[]} />);

    for (const target of ["list.add-field", "list.add-submit"]) {
      expect(screen.getByTestId(target).props.style).toEqual(
        expect.objectContaining({ minHeight: CONTROL_TARGET_HEIGHT }),
      );
    }
  });
});
