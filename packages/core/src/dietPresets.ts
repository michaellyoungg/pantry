import type { DietPreset, NutritionTarget } from "@pantry/types";
import presets from "./dietPresets.json" with { type: "json" };

/**
 * Diet presets (BL-0038).
 *
 * A preset is a *bundle of target rows*, not a feature. "Low cholesterol" is one
 * row; "high protein" is two. Nothing downstream knows a preset exists — the
 * evaluator sees ordinary targets, the schema stores ordinary targets, and the
 * goal editor edits ordinary targets. That is the whole point: adding "low
 * sodium" was an entry in `dietPresets.json` and no code at all.
 *
 * The data lives in JSON rather than a `const` so it is editable without reading
 * TypeScript, and `dietPresets.test.ts` validates every invariant the evaluator
 * would otherwise accept silently — unknown nutrient ids, bad operators,
 * duplicate constraints. Shipping a new preset is still a deploy today; the row
 * shape is what makes serving them from a table later a non-event, since
 * `applyPreset` already takes rows rather than a preset name.
 */
export const DIET_PRESETS: readonly DietPreset[] = presets as DietPreset[];

/** Look up a preset by id. */
export function dietPreset(id: string): DietPreset | undefined {
  return DIET_PRESETS.find((p) => p.id === id);
}

/**
 * The storable rows for a preset: active, and labelled so the goal editor can
 * show where a constraint came from after the preset itself is forgotten.
 *
 * Returns copies, so a caller that edits a row before saving cannot corrupt the
 * shared preset table for the rest of the session.
 */
export function presetTargets(id: string): NutritionTarget[] {
  const preset = dietPreset(id);
  if (!preset) return [];
  return preset.targets.map((t) => ({ ...t, label: t.label ?? preset.label, active: true }));
}
