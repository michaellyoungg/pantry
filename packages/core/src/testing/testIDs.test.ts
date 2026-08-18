import { describe, expect, it } from "vitest";
import { surfaceTestIDs, TEST_ID_PATTERN, testID, testIDKey, testIDPrefix } from "./testIDs";

describe("testID", () => {
  it("namespaces an element by its surface", () => {
    expect(testID("list", "generate-button")).toBe("list.generate-button");
  });

  it("appends a key for a repeated row", () => {
    expect(testID("list", "item", "whole-milk")).toBe("list.item.whole-milk");
  });

  it("produces ids matching the documented pattern", () => {
    expect(TEST_ID_PATTERN.test(testID("pantry", "empty-state"))).toBe(true);
    expect(TEST_ID_PATTERN.test(testID("pantry", "item", "canned-tomatoes"))).toBe(true);
  });

  it.each([
    ["a space", "generate button"],
    ["capitals", "generateButton"],
    ["an underscore", "generate_button"],
    ["a trailing hyphen", "generate-"],
    ["nothing", ""],
  ])("rejects %s", (_label, element) => {
    expect(() => testID("list", element)).toThrow(/lowercase alphanumeric/);
  });

  it("rejects a positional key, which silently follows the wrong row on reorder", () => {
    expect(() => testID("list", "item", "3")).toThrow(/positional/);
  });

  it("accepts a key that merely contains digits", () => {
    // Dates and quantities are legitimate identities.
    expect(testID("history", "entry", "2026-08-16")).toBe("history.entry.2026-08-16");
    expect(testID("list", "item", "1-percent-milk")).toBe("list.item.1-percent-milk");
  });
});

describe("surfaceTestIDs", () => {
  it("binds the surface so a screen module names it once", () => {
    const id = surfaceTestIDs("plan");

    expect(id("week-header")).toBe("plan.week-header");
    expect(id("slot", "monday-dinner")).toBe("plan.slot.monday-dinner");
  });
});

describe("testIDPrefix", () => {
  it("stems every keyed row of one element", () => {
    expect(testIDPrefix("list", "item")).toBe("list.item.");
  });

  it("holds the element to the same rules as testID", () => {
    expect(() => testIDPrefix("list", "Item")).toThrow(/lowercase alphanumeric/);
  });
});

describe("testIDKey", () => {
  it.each([
    ["Whole Milk", "whole-milk"],
    ["1% Milk", "1-milk"],
    ["  Extra-Virgin Olive Oil  ", "extra-virgin-olive-oil"],
    ["Crème Fraîche", "cr-me-fra-che"],
  ])("slugs %s", (input, expected) => {
    expect(testIDKey(input)).toBe(expected);
  });

  it("throws rather than emitting an empty segment", () => {
    expect(() => testIDKey("!!!")).toThrow(/no alphanumeric content/);
  });
});
