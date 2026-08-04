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
export { DIET_PRESETS, dietPreset, presetTargets } from "./dietPresets";
export { formatQuantity } from "./formatQuantity";
export {
  type AisleGroup,
  type AisleLine,
  groupByAisle,
  partitionRemoved,
  type RemovableLine,
  titleCase,
} from "./grocery";
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
  DAILY_VALUES,
  type DailyValue,
  hasTargetColumn,
  type NutritionFactsGroup,
  type NutritionFactsOptions,
  type NutritionFactsRow,
  nutritionFactsLabel,
} from "./nutritionFacts";
export {
  type DayExclusionReason,
  type DayPoint,
  type DaySummary,
  exclusionLabel,
  type GoalMetRate,
  goalMetRates,
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
  defaultServingsMultiplier,
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
export {
  type SuggestedPick,
  type SuggestionCandidate,
  type SuggestWeekInput,
  suggestWeek,
  VARIETY_SIMILARITY_THRESHOLD,
  WEEK_SUGGESTION_WEIGHTS,
  type WeekSuggestion,
} from "./weekSuggestion";
