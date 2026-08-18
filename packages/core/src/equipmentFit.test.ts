import type { EquipmentDef, EquipmentFit } from "@pantry/types";
import { describe, expect, it } from "vitest";
import {
  equipmentName,
  FIT_LABELS,
  groupByCategory,
  hiddenSummary,
  missingLabel,
  tallyFits,
} from "./equipmentFit";

const def = (id: string, name: string, category: EquipmentDef["category"]): EquipmentDef => ({
  id,
  name,
  category,
  aliases: [],
});

const CATALOG = [
  def("oven", "Oven", "appliance"),
  def("whisk", "Whisk", "tool"),
  def("skillet", "Skillet", "cookware"),
];

const mkFit = (status: EquipmentFit["status"], missing: string[] = []): EquipmentFit => ({
  status,
  missing,
  unlockedBy: [],
});

describe("groupByCategory", () => {
  it("orders appliances, then cookware, then tools", () => {
    expect(groupByCategory(CATALOG).map((g) => g.category)).toEqual([
      "appliance",
      "cookware",
      "tool",
    ]);
  });

  it("drops empty sections rather than rendering an empty heading", () => {
    expect(groupByCategory([def("oven", "Oven", "appliance")]).map((g) => g.label)).toEqual([
      "Appliances",
    ]);
  });
});

describe("missingLabel", () => {
  it("names equipment rather than showing slugs", () => {
    expect(missingLabel(CATALOG, ["oven", "whisk"])).toBe("Oven, Whisk");
  });

  it("falls back to the slug when the catalog didn't load", () => {
    expect(missingLabel([], ["stand_mixer"])).toBe("stand_mixer");
  });
});

describe("tallyFits", () => {
  it("counts the recipes on screen, not the whole library", () => {
    const fits = { a: mkFit("makeable"), b: mkFit("blocked", ["oven"]), c: mkFit("unknown") };
    expect(tallyFits(["a", "b"], fits)).toEqual({ makeable: 1, blocked: 1, unknown: 0 });
  });

  it("counts a recipe the server never classified as unknown", () => {
    // Not as makeable: an absent classification is the absence of knowledge.
    expect(tallyFits(["ghost"], {})).toEqual({ makeable: 0, blocked: 0, unknown: 1 });
  });
});

describe("hiddenSummary", () => {
  it("names blocked and unknown separately — they are different problems", () => {
    expect(hiddenSummary({ makeable: 1, blocked: 2, unknown: 3 })).toBe(
      "Hiding 2 you're missing equipment for and 3 we have no equipment details for.",
    );
  });

  it("mentions only the bucket that has anything in it", () => {
    expect(hiddenSummary({ makeable: 1, blocked: 0, unknown: 3 })).toBe(
      "Hiding 3 we have no equipment details for.",
    );
  });

  it("says nothing when nothing is hidden", () => {
    expect(hiddenSummary({ makeable: 4, blocked: 0, unknown: 0 })).toBeNull();
  });
});

describe("equipmentName", () => {
  it("resolves a slug to the catalog's name", () => {
    expect(equipmentName(CATALOG, "skillet")).toBe("Skillet");
  });

  it("falls back to the slug rather than rendering nothing", () => {
    expect(equipmentName(CATALOG, "sous_vide")).toBe("sous_vide");
  });
});

describe("FIT_LABELS", () => {
  it("words an unclassified recipe as ignorance, never as encouragement", () => {
    expect(FIT_LABELS.unknown.label).toMatch(/unknown/i);
    expect(FIT_LABELS.unknown.description).toMatch(/can't tell/i);
  });
});
