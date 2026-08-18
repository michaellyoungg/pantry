import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTags,
  formatTotalMinutes,
  humanizeSlug,
  MAX_TOTAL_MINUTES,
  parseTags,
  parseTotalMinutes,
  slugifyFacet,
} from "./discovery";

describe("parseTotalMinutes", () => {
  it("reads a whole number of minutes", () => {
    expect(parseTotalMinutes("35")).toBe(35);
    expect(parseTotalMinutes("  20 ")).toBe(20);
  });

  // Blank is "unknown", and so is junk — the field is optional, so sending
  // nothing beats sending something the service will 400 on.
  it("maps blank and unusable input to undefined", () => {
    for (const input of ["", "   ", "soon", "1.5", "-5", "0", String(MAX_TOTAL_MINUTES + 1)]) {
      expect(parseTotalMinutes(input)).toBeUndefined();
    }
  });
});

describe("formatTotalMinutes", () => {
  it("round-trips through parseTotalMinutes", () => {
    expect(parseTotalMinutes(formatTotalMinutes(45))).toBe(45);
  });

  it("renders an unknown time as a blank field, never as zero", () => {
    expect(formatTotalMinutes(undefined)).toBe("");
  });
});

describe("parseTags", () => {
  it("splits on commas and trims", () => {
    expect(parseTags("vegan, weeknight ,one pot")).toEqual(["vegan", "weeknight", "one pot"]);
  });

  it("drops blanks left by trailing or doubled commas", () => {
    expect(parseTags("vegan,,  , weeknight,")).toEqual(["vegan", "weeknight"]);
  });

  it("returns an empty list for an empty field", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("formatTags", () => {
  it("round-trips through parseTags", () => {
    expect(parseTags(formatTags(["vegan", "one-pot"]))).toEqual(["vegan", "one-pot"]);
  });

  it("treats a missing tag list as empty", () => {
    expect(formatTags(undefined)).toBe("");
  });
});

describe("humanizeSlug", () => {
  it("renders a slug as words", () => {
    expect(humanizeSlug("gluten-free")).toBe("Gluten Free");
    expect(humanizeSlug("italian")).toBe("Italian");
  });

  it("survives an empty slug", () => {
    expect(humanizeSlug("")).toBe("");
  });
});

describe("formatDuration", () => {
  it("shows minutes under an hour", () => {
    expect(formatDuration(45)).toBe("45 min");
  });

  it("shows hours and minutes above an hour", () => {
    expect(formatDuration(85)).toBe("1 h 25 min");
  });

  it("omits a zero minute part", () => {
    expect(formatDuration(120)).toBe("2 h");
  });
});

// A stored taste is compared to a recipe's stored slug (BL-0030). A preference
// typed as "South Indian" has to become the same string the recipe carries, or
// it matches nothing and the setting silently does nothing.
describe("slugifyFacet", () => {
  it("folds a typed cuisine into the slug a recipe stores", () => {
    expect(slugifyFacet("South Indian")).toBe("south-indian");
  });

  it("collapses separators and case the way the service does", () => {
    expect(slugifyFacet("  Gluten_Free  ")).toBe("gluten-free");
    expect(slugifyFacet("GLUTEN-FREE")).toBe("gluten-free");
  });

  it("returns empty for input with nothing usable, so callers can drop it", () => {
    expect(slugifyFacet("   ")).toBe("");
    expect(slugifyFacet("!!!")).toBe("");
  });
});
