import { describe, expect, it } from "vitest";
import { parseManualEntry } from "./manualEntry";

describe("parseManualEntry", () => {
  it("treats a bare name as one of the thing", () => {
    expect(parseManualEntry("foil")).toEqual({ quantity: 1, unit: "", item: "foil" });
  });

  it("reads a leading count", () => {
    expect(parseManualEntry("12 eggs")).toEqual({ quantity: 12, unit: "", item: "eggs" });
  });

  it("does not mistake a countable noun for a unit", () => {
    // "eggs" is not a measure word, so it stays part of what you are buying.
    expect(parseManualEntry("2 eggs")).toEqual({ quantity: 2, unit: "", item: "eggs" });
  });

  it("reads a leading count and a measure word", () => {
    expect(parseManualEntry("2 lb butter")).toEqual({ quantity: 2, unit: "lb", item: "butter" });
  });

  it("reads a decimal", () => {
    expect(parseManualEntry("1.5 cup milk")).toEqual({ quantity: 1.5, unit: "cup", item: "milk" });
  });

  it("folds a plural measure word to the singular the normalizer knows", () => {
    expect(parseManualEntry("2 cups milk")).toEqual({ quantity: 2, unit: "cup", item: "milk" });
  });

  it("splits a unit written flush against the number", () => {
    expect(parseManualEntry("500g flour")).toEqual({ quantity: 500, unit: "g", item: "flour" });
  });

  it("reads a written fraction", () => {
    expect(parseManualEntry("1/2 cup cream")).toEqual({
      quantity: 0.5,
      unit: "cup",
      item: "cream",
    });
  });

  it("reads a fraction glyph, which is what the list itself renders", () => {
    expect(parseManualEntry("¾ cup cream")).toEqual({ quantity: 0.75, unit: "cup", item: "cream" });
  });

  it("reads a mixed number", () => {
    expect(parseManualEntry("1 1/2 lb beef")).toEqual({ quantity: 1.5, unit: "lb", item: "beef" });
  });

  it("keeps a trailing measure word as the item, since that is all you named", () => {
    // "2 lb" alone names no product; swallowing "lb" as the unit would leave an
    // empty line, so the word stays as what was asked for.
    expect(parseManualEntry("2 lb")).toEqual({ quantity: 2, unit: "", item: "lb" });
  });

  it("ignores surrounding whitespace and collapses runs", () => {
    expect(parseManualEntry("  2   lb   ground   beef ")).toEqual({
      quantity: 2,
      unit: "lb",
      item: "ground beef",
    });
  });

  it("leaves a leading zero or negative quantity at one", () => {
    // A grocery line for "0 milk" is not a thing anyone means.
    expect(parseManualEntry("0 milk")).toEqual({ quantity: 1, unit: "", item: "milk" });
    expect(parseManualEntry("-2 milk")).toEqual({ quantity: 1, unit: "", item: "-2 milk" });
  });

  it("returns an empty item for blank input, for the caller to reject", () => {
    expect(parseManualEntry("   ")).toEqual({ quantity: 1, unit: "", item: "" });
  });

  it("does not treat a number inside a name as a count", () => {
    expect(parseManualEntry("7up")).toEqual({ quantity: 1, unit: "", item: "7up" });
  });
});
