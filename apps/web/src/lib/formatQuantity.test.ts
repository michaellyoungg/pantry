import { describe, it, expect } from "vitest";
import { formatQuantity } from "./formatQuantity";

describe("formatQuantity", () => {
  it("maps nice fractions to glyphs", () => {
    expect(formatQuantity(0.25)).toBe("¼");
    expect(formatQuantity(1 / 3)).toBe("⅓");
    expect(formatQuantity(0.5)).toBe("½");
    expect(formatQuantity(2 / 3)).toBe("⅔");
    expect(formatQuantity(0.75)).toBe("¾");
  });

  it("renders mixed numbers", () => {
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(2.75)).toBe("2¾");
  });

  it("renders whole numbers plainly", () => {
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(12)).toBe("12");
  });

  it("falls back to a trimmed 2-decimal for non-nice values", () => {
    expect(formatQuantity(0.3)).toBe("0.3");
    expect(formatQuantity(2.4)).toBe("2.4");
  });
});
