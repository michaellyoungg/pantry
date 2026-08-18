import { lastSyncedLabel } from "./lastSyncedLabel";

const NOW = 1_000 * 60 * 60 * 24;

describe("lastSyncedLabel", () => {
  it("says so plainly when nothing has ever synced", () => {
    expect(lastSyncedLabel(null, NOW)).toBe("not synced yet");
  });

  it.each([
    [30_000, "up to date a moment ago"],
    [60_000, "up to date 1 min ago"],
    [25 * 60_000, "up to date 25 min ago"],
    [60 * 60_000, "up to date an hour ago"],
    [3 * 60 * 60_000, "up to date 3 hours ago"],
  ])("rounds %ims ago to %s", (ago, expected) => {
    expect(lastSyncedLabel(NOW - ago, NOW)).toBe(expected);
  });

  it("does not read the future as a long time ago", () => {
    // A phone whose clock moved backwards while it was offline is not a reason
    // to tell the shopper their list is 400 hours old.
    expect(lastSyncedLabel(NOW + 60_000, NOW)).toBe("up to date a moment ago");
  });
});
