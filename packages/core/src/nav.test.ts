import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("holds the seven primary destinations", () => {
    // Home · Plan · Recipes · List · Pantry · History (BL-0039) · Settings (BL-0038).
    expect(NAV_ITEMS).toHaveLength(7);
  });

  it("gives every destination a distinct path, label, and icon", () => {
    // A duplicated icon name would render two tabs identically; a duplicated
    // label would make the `navigateTo` e2e helper ambiguous.
    for (const key of ["to", "label", "icon"] as const) {
      const values = NAV_ITEMS.map((item) => item[key]);
      expect(new Set(values).size).toBe(NAV_ITEMS.length);
    }
  });

  it("names icons rather than embedding glyphs", () => {
    // Rule 7 of 2026-07-18-mobile-client-design.md: emoji render inconsistently
    // across platforms, so no destination may carry one.
    for (const item of NAV_ITEMS) {
      expect(item.icon).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });
});
