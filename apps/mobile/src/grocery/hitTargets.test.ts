import {
  CHIP_HIT_SLOP,
  CONTROL_TARGET_HEIGHT,
  ROW_PRESS_PROPS,
  ROW_PRESS_RETENTION,
  ROW_TARGET_HEIGHT,
} from "./hitTargets";

describe("hit targets", () => {
  it("keeps every target at or above the 44pt accessibility floor", () => {
    expect(CONTROL_TARGET_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(ROW_TARGET_HEIGHT).toBeGreaterThanOrEqual(44);
  });

  it("makes the check-off row bigger than the floor, not merely compliant", () => {
    // The floor assumes a still hand; this screen is used walking.
    expect(ROW_TARGET_HEIGHT).toBeGreaterThan(CONTROL_TARGET_HEIGHT);
  });

  it("grows the small chips' touch area beyond their ink", () => {
    expect(Math.min(...Object.values(CHIP_HIT_SLOP))).toBeGreaterThan(0);
  });

  it("tolerates a hand that drifts mid-press", () => {
    expect(Math.min(...Object.values(ROW_PRESS_RETENTION))).toBeGreaterThanOrEqual(20);
  });

  it("bundles both halves of the row target, so a row cannot pick up only one", () => {
    // The height is observable on a rendered row and the retention offset is
    // not, so they travel together — see the comment on ROW_PRESS_PROPS.
    expect(ROW_PRESS_PROPS.pressRetentionOffset).toEqual(ROW_PRESS_RETENTION);
    expect(ROW_PRESS_PROPS.style.minHeight).toBe(ROW_TARGET_HEIGHT);
  });
});
