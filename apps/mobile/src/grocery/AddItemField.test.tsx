import { fireEvent, render, screen } from "@testing-library/react-native";
import { AddItemField } from "./AddItemField";
import { CONTROL_TARGET_HEIGHT } from "./hitTargets";

const onAdd = jest.fn();

beforeEach(() => jest.clearAllMocks());

describe("AddItemField", () => {
  it("hands over the raw text, unparsed — splitting it is the data layer's job", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);

    fireEvent.changeText(screen.getByTestId("list.add-field"), "2 lb butter");
    fireEvent.press(screen.getByTestId("list.add-submit"));

    expect(onAdd).toHaveBeenCalledWith("2 lb butter");
  });

  it("submits from the keyboard, so adding never needs a reach for the button", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);

    fireEvent.changeText(screen.getByTestId("list.add-field"), "foil");
    fireEvent(screen.getByTestId("list.add-field"), "submitEditing");

    expect(onAdd).toHaveBeenCalledWith("foil");
  });

  it("clears itself immediately, so a second add never looks like a duplicate", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);

    fireEvent.changeText(screen.getByTestId("list.add-field"), "foil");
    fireEvent.press(screen.getByTestId("list.add-submit"));

    expect(screen.getByTestId("list.add-field").props.value).toBe("");
  });

  it("cannot be submitted empty", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);

    expect(screen.getByTestId("list.add-submit").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("list.add-submit"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers what the household buys as one-tap chips — no typing at all", () => {
    render(
      <AddItemField onAdd={onAdd} recent={[{ canonicalItem: "milk", display: "Whole Milk" }]} />,
    );

    fireEvent.press(screen.getByTestId("list.add-suggestion.whole-milk"));

    expect(onAdd).toHaveBeenCalledWith("Whole Milk");
  });

  it("shows no chip row when there is nothing to suggest", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);
    expect(screen.queryByTestId("list.add-suggestion.whole-milk")).toBeNull();
  });

  it("keeps the field and its button hittable while standing", () => {
    render(<AddItemField onAdd={onAdd} recent={[]} />);

    for (const target of ["list.add-field", "list.add-submit"]) {
      expect(screen.getByTestId(target).props.style).toEqual(
        expect.objectContaining({ minHeight: CONTROL_TARGET_HEIGHT }),
      );
    }
  });
});
