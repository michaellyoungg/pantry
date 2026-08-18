import type { PlannedDay } from "@pantry/core";
import type { PlannedRow } from "@pantry/core/data";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { DayPager } from "./DayPager";

const onSelect = jest.fn();

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** Seven buckets with `counts[i]` placeholder meals on day `i`. */
function week(counts: number[] = [0, 0, 0, 0, 0, 0, 0]): PlannedDay<PlannedRow>[] {
  return LABELS.map((label, weekday) => ({
    weekday,
    label,
    fullLabel: FULL[weekday],
    items: Array.from(
      { length: counts[weekday] },
      (_, n) => ({ _id: `b${weekday}-${n}`, recipeId: `r${n}`, title: `Meal ${n}` }) as PlannedRow,
    ),
  }));
}

beforeEach(() => jest.clearAllMocks());

describe("DayPager", () => {
  it("offers all seven days, so no day is unreachable", async () => {
    await render(<DayPager days={week()} onSelect={onSelect} selected={0} />);

    for (const label of LABELS) {
      expect(screen.getByTestId(`plan.day.${label.toLowerCase()}`)).toBeOnTheScreen();
    }
  });

  it("selects the day that was tapped", async () => {
    await render(<DayPager days={week()} onSelect={onSelect} selected={0} />);
    await fireEvent.press(screen.getByTestId("plan.day.thu"));

    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("marks which day is showing, for a screen reader as well as the eye", async () => {
    await render(<DayPager days={week()} onSelect={onSelect} selected={4} />);

    expect(screen.getByTestId("plan.day.fri").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("plan.day.mon").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it("marks the days that have something on them", async () => {
    await render(<DayPager days={week([0, 2, 0, 1, 0, 0, 0])} onSelect={onSelect} selected={0} />);

    expect(screen.getByTestId("plan.day-dot.tue")).toBeOnTheScreen();
    expect(screen.getByTestId("plan.day-dot.thu")).toBeOnTheScreen();
    expect(screen.queryByTestId("plan.day-dot.mon")).toBeNull();
  });

  it("says how full a day is without making the strip readable only by eye", async () => {
    await render(<DayPager days={week([0, 2, 0, 0, 0, 0, 0])} onSelect={onSelect} selected={0} />);

    expect(screen.getByTestId("plan.day.tue").props.accessibilityLabel).toBe("Tuesday — 2 meals");
    expect(screen.getByTestId("plan.day.mon").props.accessibilityLabel).toBe(
      "Monday — nothing planned",
    );
  });

  it("keeps every chip on the 44pt floor despite there being seven of them", async () => {
    await render(<DayPager days={week()} onSelect={onSelect} selected={0} />);

    for (const label of LABELS) {
      expect(screen.getByTestId(`plan.day.${label.toLowerCase()}`).props.style).toEqual(
        expect.objectContaining({ minHeight: CONTROL_TARGET_HEIGHT }),
      );
    }
  });
});
