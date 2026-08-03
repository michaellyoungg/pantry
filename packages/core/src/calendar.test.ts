import { describe, expect, it } from "vitest";
import {
  addDays,
  dateForWeekday,
  datesInRange,
  parseISODate,
  startOfWeek,
  toISODate,
  windowEndingOn,
} from "./calendar";

describe("toISODate", () => {
  it("uses the local calendar day, not UTC", () => {
    // 8pm local on the 3rd is still the 3rd, whatever the offset does to UTC.
    expect(toISODate(new Date(2026, 7, 3, 20, 0, 0))).toBe("2026-08-03");
    expect(toISODate(new Date(2026, 0, 1, 0, 30, 0))).toBe("2026-01-01");
  });

  it("zero-pads month and day", () => {
    expect(toISODate(new Date(2026, 8, 9))).toBe("2026-09-09");
  });
});

describe("parseISODate", () => {
  it("parses to local midnight", () => {
    const d = parseISODate("2026-08-03");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 7, 3, 0]);
  });

  it("rejects malformed input", () => {
    expect(() => parseISODate("3 Aug 2026")).toThrow(/YYYY-MM-DD/);
    expect(() => parseISODate("2026-8-3")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a date that does not exist", () => {
    expect(() => parseISODate("2026-02-31")).toThrow(/calendar date/);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("crosses a year boundary backwards", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("startOfWeek", () => {
  it("returns the containing Monday", () => {
    // 2026-08-03 is a Monday; 2026-08-09 is the Sunday that ends its week.
    expect(startOfWeek("2026-08-03")).toBe("2026-08-03");
    expect(startOfWeek("2026-08-06")).toBe("2026-08-03");
    expect(startOfWeek("2026-08-09")).toBe("2026-08-03");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    expect(startOfWeek("2026-08-02")).toBe("2026-07-27");
  });
});

describe("dateForWeekday", () => {
  it("maps 0=Mon…6=Sun onto the week", () => {
    expect(dateForWeekday("2026-08-03", 0)).toBe("2026-08-03");
    expect(dateForWeekday("2026-08-03", 6)).toBe("2026-08-09");
  });

  it("rejects an out-of-range weekday", () => {
    expect(() => dateForWeekday("2026-08-03", 7)).toThrow(/0\.\.6/);
    expect(() => dateForWeekday("2026-08-03", -1)).toThrow(/0\.\.6/);
  });
});

describe("datesInRange", () => {
  it("is inclusive at both ends", () => {
    expect(datesInRange({ from: "2026-08-03", to: "2026-08-05" })).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("returns a single day when from equals to", () => {
    expect(datesInRange({ from: "2026-08-03", to: "2026-08-03" })).toEqual(["2026-08-03"]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(datesInRange({ from: "2026-08-05", to: "2026-08-03" })).toEqual([]);
  });
});

describe("windowEndingOn", () => {
  it("counts the end day as one of the days", () => {
    expect(windowEndingOn("2026-08-09", 7)).toEqual({ from: "2026-08-03", to: "2026-08-09" });
  });

  it("rejects a non-positive length", () => {
    expect(() => windowEndingOn("2026-08-09", 0)).toThrow(/positive/);
  });
});
