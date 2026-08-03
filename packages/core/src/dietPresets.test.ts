import { describe, expect, it } from "vitest";
import { DIET_PRESETS, dietPreset, presetTargets } from "./dietPresets";
import { nutrientMeta } from "./nutrition";
import { evaluateTargets } from "./nutritionTargets";

describe("diet presets are data", () => {
  it("ships the presets the design names", () => {
    expect(DIET_PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining(["high-protein", "low-cholesterol", "low-carb"]),
    );
  });

  it("resolves a preset by id", () => {
    expect(dietPreset("low-carb")?.label).toBe("Low carb");
  });

  it("returns undefined for an unknown preset", () => {
    expect(dietPreset("paleo-keto-carnivore")).toBeUndefined();
  });

  it("uses unique preset ids", () => {
    const ids = DIET_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every preset at least one target", () => {
    for (const preset of DIET_PRESETS) {
      expect(preset.targets.length).toBeGreaterThan(0);
    }
  });

  // The point of shipping presets as data is that adding one needs no code
  // change — which is only safe if the data itself is checked. These are the
  // invariants the evaluator would otherwise silently accept.
  it("only references nutrients the catalog can label", () => {
    for (const preset of DIET_PRESETS) {
      for (const t of preset.targets) {
        expect(nutrientMeta(t.nutrientId), `${preset.id} → ${t.nutrientId}`).toBeDefined();
      }
    }
  });

  it("uses only declared operators and periods", () => {
    for (const preset of DIET_PRESETS) {
      for (const t of preset.targets) {
        expect(["<=", ">=", "=="]).toContain(t.operator);
        expect(["day", "week", "meal"]).toContain(t.period);
      }
    }
  });

  it("uses finite, non-negative target values", () => {
    for (const preset of DIET_PRESETS) {
      for (const t of preset.targets) {
        expect(Number.isFinite(t.value)).toBe(true);
        expect(t.value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not constrain the same nutrient twice in one period", () => {
    for (const preset of DIET_PRESETS) {
      const keys = preset.targets.map((t) => `${t.nutrientId}:${t.period}`);
      expect(new Set(keys).size, preset.id).toBe(keys.length);
    }
  });

  it("describes every preset for the goal editor", () => {
    for (const preset of DIET_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});

describe("presetTargets", () => {
  it("turns a preset into active rows ready to store", () => {
    const rows = presetTargets("low-cholesterol");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.active).toBe(true);
    }
  });

  it("labels rows with the preset when the row carries no label of its own", () => {
    const preset = dietPreset("high-protein");
    const rows = presetTargets("high-protein");
    for (const row of rows) {
      expect(row.label).toBeTruthy();
    }
    expect(rows.some((r) => r.label === preset?.label)).toBe(true);
  });

  it("returns nothing for an unknown preset rather than throwing", () => {
    expect(presetTargets("not-a-diet")).toEqual([]);
  });

  it("produces rows the evaluator accepts", () => {
    const rows = presetTargets("low-carb");
    const vector = {
      nutrients: { "1005": { nutrientId: "1005", amount: 40, unit: "g" } },
      coverage: { resolvedMassFraction: 1, resolvedCount: 3, totalCount: 3 },
    };
    const results = evaluateTargets(rows, vector, "day");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.status !== "unknown" || r.reason === "nutrient-missing")).toBe(
      true,
    );
  });

  it("returns fresh rows each call so callers cannot mutate the preset data", () => {
    const first = presetTargets("low-carb");
    first[0].value = 9999;
    expect(presetTargets("low-carb")[0].value).not.toBe(9999);
  });
});
