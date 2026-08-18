import type { ReplayConflict } from "@pantry/core";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ReplayConflictSheet } from "./ReplayConflictSheet";

function conflict(over: Partial<ReplayConflict> = {}): ReplayConflict {
  return {
    key: "Butter|g|dairy",
    item: "Butter",
    unit: "g",
    aisle: "dairy",
    checked: true,
    reason: "superseded",
    ...over,
  };
}

const noop = () => {};

describe("ReplayConflictSheet", () => {
  it("names the other device when somebody else got there first", async () => {
    await render(<ReplayConflictSheet conflict={conflict()} onApply={noop} onDismiss={noop} />);

    expect(screen.getByTestId("list.conflict-sheet")).toHaveTextContent(
      /Somebody else changed Butter/,
    );
    expect(screen.getByTestId("list.conflict-detail")).toHaveTextContent(/another device/);
  });

  it("says what was lost when the line is gone, not just that something failed", async () => {
    // The whole reason this case is surfaced: a purchase *and* its pantry
    // inflow. A prompt that only said "could not sync" would not earn the tap.
    await render(
      <ReplayConflictSheet
        conflict={conflict({ reason: "missing" })}
        onApply={noop}
        onDismiss={noop}
      />,
    );

    expect(screen.getByTestId("list.conflict-detail")).toHaveTextContent(/adds it to your pantry/);
    expect(screen.getByTestId("list.conflict-apply")).toHaveTextContent("Put it back on my list");
  });

  it("offers no action for a lost line the shopper had un-ticked", async () => {
    // There is nothing to un-tick and nothing worth putting back, so the only
    // honest thing the sheet can do is say so and get out of the way.
    await render(
      <ReplayConflictSheet
        conflict={conflict({ reason: "missing", checked: false })}
        onApply={noop}
        onDismiss={noop}
      />,
    );

    expect(screen.queryByTestId("list.conflict-apply")).toBeNull();
    expect(screen.getByTestId("list.conflict-dismiss")).toHaveTextContent("Got it");
  });

  it("hands each answer back untouched", async () => {
    const onApply = jest.fn();
    const onDismiss = jest.fn();
    await render(
      <ReplayConflictSheet conflict={conflict()} onApply={onApply} onDismiss={onDismiss} />,
    );

    await fireEvent.press(screen.getByTestId("list.conflict-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId("list.conflict-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on the scrim, like every other sheet on this screen", async () => {
    const onDismiss = jest.fn();
    await render(
      <ReplayConflictSheet conflict={conflict()} onApply={noop} onDismiss={onDismiss} />,
    );

    await fireEvent.press(screen.getByTestId("list.conflict-sheet-scrim"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
