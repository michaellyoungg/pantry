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
export { COOKING_METHOD_LABELS, COOKING_METHODS } from "./cookingMethods";
export {
  applyCatalogFilter,
  type CatalogFilter,
  cuisinesIn,
  dietsIn,
  emptyCatalogFilter,
  isFilterActive,
  toggleFacet,
} from "./catalogFilter";
export { DIET_PRESETS, dietPreset, presetTargets } from "./dietPresets";
export {
  COOK_TIME_BUCKETS,
  type CookTimeBucketId,
  DIET_TAGS,
  formatDuration,
  formatTags,
  formatTotalMinutes,
  humanizeSlug,
  MAX_TOTAL_MINUTES,
  parseTags,
  parseTotalMinutes,
  slugifyFacet,
} from "./discovery";
export {
  EXPIRY_HORIZON_DAYS,
  expiringSoon,
  formatUseBy,
  isOverdue,
  type PantryRow,
} from "./expiry";
export {
  type EquipmentGroup,
  equipmentName,
  FIT_LABELS,
  type FitLabel,
  type FitTally,
  groupByCategory,
  hiddenSummary,
  missingLabel,
  tallyFits,
} from "./equipmentFit";
export { formatQuantity } from "./formatQuantity";
export {
  type AisleGroup,
  type AisleLine,
  type CartLine,
  changedLineIds,
  groupByAisle,
  type PurchasedLine,
  partitionCart,
  partitionRemoved,
  pluralizeUnit,
  purchaseText,
  type RemovableLine,
  residueText,
  SWIPE_COMMIT_PX,
  SWIPE_MAX_PX,
  SWIPE_SLOP_PX,
  type SwipeState,
  type SyncableLine,
  titleCase,
  trackSwipe,
} from "./grocery";
export {
  applyPending,
  type CollapsedCheckoff,
  collapsePending,
  decodeGroceryCache,
  encodeGroceryCache,
  GROCERY_CACHE_VERSION,
  type GroceryCache,
  groceryLineKey,
  type KeyedLine,
  type OfflineStore,
  type PendingCheckoff,
  planReplay,
  type ReplayableLine,
  type ReplayConflict,
  type ReplayPlan,
  type ReplayWrite,
} from "./groceryOffline";
// Only the state itself crosses the boundary: `deriveHomeState` is called by
// `useHome` in @pantry/core/data, and a view renders the answer, never derives it.
export type { HomeState } from "./home";
export { type ManualEntry, parseManualEntry } from "./manualEntry";
export { NAV_ITEMS, type NavIconName, type NavItem, type NavRoute } from "./nav";
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
  NUTRITION_FACTS_FOOTNOTES,
  NUTRITION_FACTS_NOT_ESTIMATED,
  NUTRITION_FACTS_TITLE,
  type NutritionFactsGroup,
  type NutritionFactsOptions,
  type NutritionFactsRow,
  nutritionFactsLabel,
} from "./nutritionFacts";
export {
  GOAL_OPERATORS,
  GOAL_PERIODS,
  GOAL_VERDICT_LABELS,
  type GoalChip,
  type GoalSummary,
  type GoalTone,
  type GoalVerdict,
  goalChips,
  goalLabel,
  goalSummary,
  goalVerdict,
  hardConstraintCount,
  parseGoalValue,
  unverifiedLabel,
} from "./nutritionGoals";
export {
  type GoalFit,
  type RecipeNutritionView,
  recipeGoalFit,
  recipeNutritionView,
} from "./nutritionRecipe";
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
  type PlanDayGoals,
  type PlanDayNutrition,
  type PlanGoalStatus,
  type PlanNutrition,
  type PlanNutritionDay,
  type PlanNutritionView,
  planGoalStatus,
  planNutritionSignature,
  planNutritionView,
  rollUpWeekNutrition,
  summarizeNutrition,
  type WeekNutritionRollup,
} from "./nutritionRollup";
export { EQUALITY_BAND, evaluateTargets, type NutritionVector } from "./nutritionTargets";
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
  doneSet,
  dueByToday,
  formatDueOn,
  hasLeadTime,
  type PlannedRow,
  PREP_WINDOW_LABELS,
  type PrepTaskForMeal,
  prepPlanSignature,
  stateKey,
} from "./prep";
export {
  draftFromRecipe,
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
export { formatServings, MAX_SERVINGS, parseServings } from "./servings";
export { DAY_FULL, DAYS, weekdayOf } from "./week";
export {
  type SuggestedPick,
  type SuggestionCandidate,
  type SuggestWeekInput,
  suggestWeek,
  VARIETY_SIMILARITY_THRESHOLD,
  WEEK_SUGGESTION_WEIGHTS,
  type WeekSuggestion,
} from "./weekSuggestion";
