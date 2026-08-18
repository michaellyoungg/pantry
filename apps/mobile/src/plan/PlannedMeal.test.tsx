import { stateKey } from "@pantry/core";
import type { WeekPlanRow } from "@pantry/core/data";
import type { PrepMeal } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { PlannedMeal } from "./PlannedMeal";

const handlers = {
  onIncreaseServings: jest.fn(),
  onDecreaseServings: jest.fn(),
  onToggleType: jest.fn(),
  onToggleCooked: jest.fn(),
  onMove: jest.fn(),
};

async function meal(
  over: Partial<WeekPlanRow> = {},
  prep?: PrepMeal,
  prepDone = new Set<string>(),
) {
  const row = {
    _id: "b1",
    recipeId: "r1",
    title: "Roast Chicken",
    weekday: 0,
    ...over,
  } as WeekPlanRow;
  return await render(<PlannedMeal prep={prep} prepDone={prepDone} row={row} {...handlers} />);
}

const THAW = {
  recipeId: "r1",
  title: "Roast Chicken",
  cookDate: "2026-08-20",
  tasks: [
    { key: "thaw", text: "Take the chicken out", window: "night_before", missed: false },
    { key: "preheat", text: "Heat the oven", window: "at_start", missed: false },
  ],
} as unknown as PrepMeal;

beforeEach(() => jest.clearAllMocks());

describe("PlannedMeal", () => {
  it("is addressable by the shared name both clients emit", async () => {
    await meal();
    expect(screen.getByTestId("plan.meal.roast-chicken")).toBeOnTheScreen();
  });

  it("shows an unset dial as a single batch rather than as blank", async () => {
    await meal();
    expect(screen.getByTestId("plan.servings.roast-chicken")).toHaveTextContent("×1");
  });

  it("steps the dial in both directions", async () => {
    await meal({ servingsMultiplier: 1.5 });
    expect(screen.getByTestId("plan.servings.roast-chicken")).toHaveTextContent("×1.5");

    await fireEvent.press(screen.getByTestId("plan.servings-up.roast-chicken"));
    expect(handlers.onIncreaseServings).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("plan.servings-down.roast-chicken"));
    expect(handlers.onDecreaseServings).toHaveBeenCalled();
  });

  it("drops the dial for a leftover, which adds nothing to the list", async () => {
    await meal({ type: "leftover" });

    expect(screen.queryByTestId("plan.servings.roast-chicken")).toBeNull();
    expect(screen.getByTestId("plan.leftover-note.roast-chicken")).toBeOnTheScreen();
  });

  it("offers to cook a meal and to eat a leftover", async () => {
    await meal();
    expect(screen.getByTestId("plan.cooked.roast-chicken").props.accessibilityLabel).toBe(
      "Mark Roast Chicken as cooked",
    );

    await meal({ type: "leftover" });
    expect(screen.getByTestId("plan.cooked.roast-chicken").props.accessibilityLabel).toBe(
      "Mark Roast Chicken as eaten",
    );
  });

  it("shows a cooked meal as done and offers to undo it", async () => {
    await meal({ cookedAt: 1 });
    const button = screen.getByTestId("plan.cooked.roast-chicken");

    expect(button.props.accessibilityLabel).toBe("Mark Roast Chicken as not cooked");
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await fireEvent.press(button);
    expect(handlers.onToggleCooked).toHaveBeenCalled();
  });

  it("flips between a meal and a leftover", async () => {
    await meal();
    expect(screen.getByTestId("plan.type.roast-chicken").props.accessibilityLabel).toBe(
      "Mark Roast Chicken as leftovers",
    );

    await fireEvent.press(screen.getByTestId("plan.type.roast-chicken"));
    expect(handlers.onToggleType).toHaveBeenCalled();
  });

  it("asks to move rather than expecting a drag", async () => {
    await meal();
    await fireEvent.press(screen.getByTestId("plan.move.roast-chicken"));

    expect(handlers.onMove).toHaveBeenCalled();
  });

  it("names the earliest lead-time prep, so a thaw is seen when the meal is planned", async () => {
    await meal({}, THAW);

    expect(screen.getByTestId("plan.prep.roast-chicken")).toHaveTextContent(
      "⏱ Prep: the night before",
    );
  });

  it("ignores prep that is just cooking, or every dish would carry a badge", async () => {
    // `at_start` is the only task left once the thaw is ticked.
    await meal({}, THAW, new Set([stateKey("thaw", "2026-08-20")]));

    expect(screen.queryByTestId("plan.prep.roast-chicken")).toBeNull();
    expect(screen.getByTestId("plan.prep-done.roast-chicken")).toBeOnTheScreen();
  });

  it("badges nothing on a leftover, which is reheated rather than prepped", async () => {
    await meal({ type: "leftover" }, THAW);

    expect(screen.queryByTestId("plan.prep.roast-chicken")).toBeNull();
  });

  it("keeps every control on the 44pt floor", async () => {
    await meal();

    for (const testID of [
      "plan.servings-up.roast-chicken",
      "plan.servings-down.roast-chicken",
      "plan.cooked.roast-chicken",
      "plan.type.roast-chicken",
      "plan.move.roast-chicken",
    ]) {
      expect(screen.getByTestId(testID).props.style).toEqual(
        expect.objectContaining({ minHeight: CONTROL_TARGET_HEIGHT }),
      );
    }
  });
});
