import type { WeekPlanRow } from "@pantry/core/data";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { UnplannedRail } from "./UnplannedRail";

const onSchedule = jest.fn();
const onRemove = jest.fn();

const row = (title: string, id: string): WeekPlanRow =>
  ({ _id: id, recipeId: id, title }) as WeekPlanRow;

async function rail(rows: WeekPlanRow[], dayLabel = "Thursday") {
  return await render(
    <UnplannedRail dayLabel={dayLabel} onRemove={onRemove} onSchedule={onSchedule} rows={rows} />,
  );
}

beforeEach(() => jest.clearAllMocks());

describe("UnplannedRail", () => {
  it("says the basket is fully planned rather than showing nothing", async () => {
    await rail([]);
    expect(screen.getByTestId("plan.rail-empty")).toBeOnTheScreen();
  });

  it("names each waiting recipe by the shared id", async () => {
    await rail([row("Green Curry", "b1"), row("Lentil Soup", "b2")]);

    expect(screen.getByTestId("plan.unplanned.green-curry")).toBeOnTheScreen();
    expect(screen.getByTestId("plan.unplanned.lentil-soup")).toBeOnTheScreen();
  });

  it("plans onto the day the pager is showing, in one tap", async () => {
    const green = row("Green Curry", "b1");
    await rail([green]);

    expect(screen.getByTestId("plan.rail-schedule.green-curry")).toHaveTextContent(
      "Plan for Thursday",
    );
    await fireEvent.press(screen.getByTestId("plan.rail-schedule.green-curry"));
    expect(onSchedule).toHaveBeenCalledWith(green);
  });

  it("follows the pager, so the button never offers a day that is not showing", async () => {
    await rail([row("Green Curry", "b1")], "Saturday");
    expect(screen.getByTestId("plan.rail-schedule.green-curry")).toHaveTextContent(
      "Plan for Saturday",
    );
  });

  it("removes a recipe from the basket", async () => {
    const green = row("Green Curry", "b1");
    await rail([green]);
    await fireEvent.press(screen.getByTestId("plan.rail-remove.green-curry"));

    expect(onRemove).toHaveBeenCalledWith(green);
    expect(onSchedule).not.toHaveBeenCalled();
  });
});
