import { describe, expect, it } from "vitest";
import { EXPIRY_HORIZON_DAYS, expiringSoon, formatUseBy, type PantryRow } from "./expiry";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);

function row(over: Partial<PantryRow> = {}): PantryRow {
  return {
    _id: `p${Math.random()}`,
    display: "Spinach",
    canonicalItem: "spinach",
    state: "have",
    useBy: NOW + 2 * DAY,
    ...over,
  };
}

describe("expiringSoon", () => {
  it("keeps only rows inside the horizon", () => {
    const soon = row({ canonicalItem: "spinach", useBy: NOW + 3 * DAY });
    const later = row({ canonicalItem: "rice", useBy: NOW + (EXPIRY_HORIZON_DAYS + 1) * DAY });

    expect(expiringSoon([soon, later], NOW).map((r) => r.canonicalItem)).toEqual(["spinach"]);
  });

  it("includes items already past their date", () => {
    const overdue = row({ canonicalItem: "milk", useBy: NOW - 3 * DAY });

    expect(expiringSoon([overdue], NOW)).toHaveLength(1);
  });

  it("ignores rows with no known use-by", () => {
    expect(expiringSoon([row({ useBy: undefined })], NOW)).toEqual([]);
  });

  it("ignores items marked out — the user already used them", () => {
    expect(expiringSoon([row({ state: "out" })], NOW)).toEqual([]);
  });

  it("keeps low items, which are still in the fridge going off", () => {
    expect(expiringSoon([row({ state: "low" })], NOW)).toHaveLength(1);
  });

  it("orders the batch soonest first", () => {
    const rows = [
      row({ canonicalItem: "c", useBy: NOW + 5 * DAY }),
      row({ canonicalItem: "a", useBy: NOW - DAY }),
      row({ canonicalItem: "b", useBy: NOW + DAY }),
    ];

    expect(expiringSoon(rows, NOW).map((r) => r.canonicalItem)).toEqual(["a", "b", "c"]);
  });
});

describe("formatUseBy", () => {
  it("phrases everything as an approximation", () => {
    // The date is derived from a shelf-life table, not read off a carton.
    expect(formatUseBy(NOW + 5 * DAY, NOW)).toBe("~5 days");
  });

  it("uses plain words for today and tomorrow", () => {
    expect(formatUseBy(NOW + 0.5 * DAY, NOW)).toBe("~today");
    expect(formatUseBy(NOW + 1.5 * DAY, NOW)).toBe("~tomorrow");
  });

  it("reads past dates as overdue", () => {
    expect(formatUseBy(NOW - 3 * DAY, NOW)).toBe("~3 days ago");
    expect(formatUseBy(NOW - 1 * DAY, NOW)).toBe("~1 day ago");
  });

  it("coarsens long horizons so staples don't shout a precise day count", () => {
    expect(formatUseBy(NOW + 21 * DAY, NOW)).toBe("~3 wk");
    expect(formatUseBy(NOW + 90 * DAY, NOW)).toBe("~3 mo");
    expect(formatUseBy(NOW + 730 * DAY, NOW)).toBe("~2 yr");
  });
});
