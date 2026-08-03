// @pantry/core — the headless domain layer.
//
// Pure, platform-free logic shared by every client: no React, no DOM, no
// styling (see the `packages/core/src/**` overrides in biome.json and the
// DOM-less `lib` in tsconfig.json, which enforce that mechanically). React
// hooks live in `@pantry/core/react`; Convex-aware helpers in
// `@pantry/core/convex`.

export { DIET_PRESETS, dietPreset, presetTargets } from "./dietPresets";
export { formatQuantity } from "./formatQuantity";
export { type AisleGroup, type AisleLine, groupByAisle, titleCase } from "./grocery";
export { type ManualEntry, parseManualEntry } from "./manualEntry";
export {
  formatNutrientAmount,
  HEADLINE_NUTRIENTS,
  NUTRITION_COVERAGE_THRESHOLD,
  type NutrientMeta,
  type NutrientRow,
  nutrientMeta,
  nutrientRows,
  unresolvedItems,
} from "./nutrition";
export {
  type DayNutritionSummary,
  type NutritionGaps,
  type NutritionSummary,
  type PlanDayNutrition,
  type PlanNutrition,
  planNutritionSignature,
  rollUpWeekNutrition,
  summarizeNutrition,
  type WeekNutritionRollup,
} from "./nutritionRollup";
export {
  EQUALITY_BAND,
  evaluateTargets,
  type NutritionVector,
} from "./nutritionTargets";
export {
  canGenerateList,
  decreaseServings,
  increaseServings,
  isCooked,
  isLeftover,
  MIN_SERVINGS_MULTIPLIER,
  type PlannedDay,
  type PlannedItem,
  planWeek,
  SERVINGS_STEP,
  servingsMultiplier,
  toggledType,
  unscheduledItems,
} from "./planner";
export {
  draftImportUrl,
  draftSubmission,
  emptyDraft,
  emptyIngredient,
  type ImportedRecipe,
  type RecipeDraft,
  type RecipeSubmission,
  withExtraIngredient,
  withImportedRecipe,
  withIngredientPatch,
  withServings,
  withSteps,
} from "./recipeDraft";
export { DAY_FULL, DAYS } from "./week";
