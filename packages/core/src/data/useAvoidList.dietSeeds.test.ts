import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIET_SEEDS } from "./useAvoidList";

// This is the assertion that would have caught BL-0005's avoid-list bug: the
// diet seeds looked plausible ("beef", "cheese", "fish") but were not actual
// canonical items, so avoiding "vegetarian" silently filtered nothing for
// "ground beef" or "cheddar cheese" recipes. Reading normalization.json
// straight from the repo (rather than a fixture) means this fails the moment
// the two drift again, instead of only when someone remembers to check.
describe("DIET_SEEDS", () => {
  const normalizationPath = path.resolve(
    import.meta.dirname,
    "../../../../apps/recipe-service/internal/recipe/normalization.json",
  );
  const normalization = JSON.parse(readFileSync(normalizationPath, "utf-8")) as {
    items: Record<string, unknown>;
  };
  const canonicalItems = new Set(Object.keys(normalization.items));

  it("has at least one diet with at least one seed, so the check below is not vacuous", () => {
    const allSeeds = Object.values(DIET_SEEDS).flat();
    expect(allSeeds.length).toBeGreaterThan(0);
  });

  for (const [diet, seeds] of Object.entries(DIET_SEEDS)) {
    it(`every "${diet}" seed is a real canonical item in normalization.json`, () => {
      const bogus = seeds.filter((seed) => !canonicalItems.has(seed));
      expect(bogus).toEqual([]);
    });
  }
});
