// @pantry/core — the headless domain layer.
//
// Pure, platform-free logic shared by every client: no React, no DOM, no
// styling (see the `packages/core/src/**` overrides in biome.json and the
// DOM-less `lib` in tsconfig.json, which enforce that mechanically). React
// hooks live in `@pantry/core/react`; Convex-aware helpers in
// `@pantry/core/convex`.

export {
  addDays,
  type DateRange,
  dateForWeekday,
  datesInRange,
  parseISODate,
  startOfWeek,
  toISODate,
  windowEndingOn,
} from "./calendar";
export { formatQuantity } from "./formatQuantity";
export { type AisleGroup, type AisleLine, groupByAisle, titleCase } from "./grocery";
export {
  type DayExclusionReason,
  type DayPoint,
  type DaySummary,
  exclusionLabel,
  type HabitReview,
  type HabitReviewOptions,
  type HabitSignal,
  habitReview,
  habitSignal,
  MIN_DAY_COVERAGE,
  type NutrientTrend,
  type TrendDirection,
} from "./nutritionHistory";
export {
  canGenerateList,
  decreaseServings,
  increaseServings,
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
