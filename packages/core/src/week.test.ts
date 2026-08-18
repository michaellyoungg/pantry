import { describe, expect, it } from "vitest";
import { DAY_FULL, DAYS, weekdayOf } from "./week";

describe("weekdayOf", () => {
  it("puts Monday first, matching basket.weekday", () => {
    expect(weekdayOf(new Date(2026, 7, 17))).toBe(0); // a Monday
  });

  it("puts Sunday last rather than wrapping it to the front", () => {
    expect(weekdayOf(new Date(2026, 7, 23))).toBe(6);
  });

  it("indexes the labels it is meant to index", () => {
    const week = [17, 18, 19, 20, 21, 22, 23].map((day) => weekdayOf(new Date(2026, 7, day)));
    expect(week).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(week.map((d) => DAYS[d])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(DAY_FULL[weekdayOf(new Date(2026, 7, 23))]).toBe("Sunday");
  });

  it("reads the local calendar day, not UTC", () => {
    // A late Sunday in a negative-offset zone is already Monday in UTC.
    expect(weekdayOf(new Date(2026, 7, 23, 23, 30))).toBe(6);
  });
});
