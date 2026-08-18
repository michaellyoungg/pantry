import { describe, expect, it } from "vitest";
import { formatServings, parseServings } from "./servings";

describe("parseServings", () => {
  it("reads a whole count", () => {
    expect(parseServings("4")).toBe(4);
    expect(parseServings("  6 ")).toBe(6);
    expect(parseServings("100")).toBe(100);
  });

  // Blank is how the form says "yield unknown", which must stay distinct from
  // zero — every per-serving figure downstream keys off undefined.
  it("maps a blank field to undefined, not zero", () => {
    expect(parseServings("")).toBeUndefined();
    expect(parseServings("   ")).toBeUndefined();
  });

  it("rejects values that cannot be a real yield", () => {
    expect(parseServings("0")).toBeUndefined();
    expect(parseServings("-3")).toBeUndefined();
    expect(parseServings("1.5")).toBeUndefined();
    expect(parseServings("101")).toBeUndefined();
    expect(parseServings("abc")).toBeUndefined();
  });
});

describe("formatServings", () => {
  it("round-trips a known count", () => {
    expect(formatServings(4)).toBe("4");
    expect(parseServings(formatServings(4))).toBe(4);
  });

  it("renders an unknown yield as a blank field", () => {
    expect(formatServings(undefined)).toBe("");
  });
});
