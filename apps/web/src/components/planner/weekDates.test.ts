import { describe, expect, it } from "vitest";
import { addDays, formatWeekLabel, sundayOf, weekDays, weekdayLabel } from "./weekDates";

describe("weekDates", () => {
  it("sundayOf returns the Sunday of the week (Sun-start)", () => {
    expect(sundayOf("2026-07-15")).toBe("2026-07-12");
    expect(sundayOf("2026-07-12")).toBe("2026-07-12");
    expect(sundayOf("2026-07-18")).toBe("2026-07-12");
  });

  it("weekDays lists 7 ISO dates Sun..Sat", () => {
    expect(weekDays("2026-07-12")).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });

  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("formats a readable week label and weekday", () => {
    expect(formatWeekLabel("2026-07-12")).toBe("Jul 12 – 18");
    expect(weekdayLabel("2026-07-12")).toBe("Sun");
  });
});
