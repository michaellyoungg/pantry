export interface Ingredient {
  quantity: number;
  unit: string;
  item: string;
  note?: string;
}

export interface Recipe {
  id: string;
  userId: string;
  title: string;
  /**
   * How many people the recipe feeds. Absent means the yield is unknown —
   * existing recipes and manual entry without a yield both leave it unset, so
   * consumers must omit per-serving figures rather than assume a default.
   *
   * This is an absolute count. It is not the planner's `servingsMultiplier`,
   * which is a scale factor ("cook 1.5x this recipe") on a basket entry.
   */
  servings?: number;
  ingredients: Ingredient[];
  /** Ordered instruction lines (the method). Empty for ingredients-only recipes. */
  steps: string[];
  createdAt: string; // ISO-8601
}

export interface GroceryLine {
  item: string;
  /** Normalized ingredient key ("green onion"); the identity the pantry joins on. */
  canonicalItem: string;
  unit: string;
  quantity: number;
  aisle: string;
}

export interface CreateRecipeRequest {
  title: string;
  /** Omit when unknown; recipe-service rejects a value outside 1..100. */
  servings?: number;
  ingredients: Ingredient[];
  steps?: string[];
}

export interface GroceryListItem {
  recipeId: string;
  multiplier: number;
}

export interface GroceryListRequest {
  items: GroceryListItem[];
}

export interface ImportRecipeRequest {
  url: string;
}

/**
 * One nutrient amount, keyed by FDC nutrient number ("1008" energy kcal, "1003"
 * protein, "1253" cholesterol). We use FDC's numbering rather than inventing a
 * parallel taxonomy.
 */
export interface NutrientAmount {
  nutrientId: string;
  amount: number;
  unit: string;
}

/** How much of a recipe the estimate actually accounts for. Never optional. */
export interface NutritionCoverage {
  /** 0..1 of the recipe's mass that resolved to a food with nutrient data. */
  resolvedMassFraction: number;
  resolvedCount: number;
  totalCount: number;
}

/** Per-ingredient provenance: what we made of each line, and why we failed. */
export interface NutritionIngredient {
  item: string;
  /** null when the line's mass could not be determined. */
  grams: number | null;
  /** True only if the line contributed nutrients — mass known AND food matched. */
  resolved: boolean;
  /** Why the line is unresolved, e.g. `no gram weight for unit "pinch"`. */
  reason?: string;
  /** How the grams were derived: mass | portion | density | count. */
  method?: string;
  /** The FDC description matched, so a wrong fuzzy match is visible. */
  matchedFood?: string;
}

/**
 * An estimated nutrient vector for a recipe or a selection of recipes.
 *
 * `nutrients` is an open map on purpose — adding a nutrient must be a data
 * change, never a wire-type change across three languages. Do not narrow it to
 * a typed macro struct.
 */
export interface NutritionEstimate {
  nutrients: Record<string, NutrientAmount>;
  /** Absent when the recipe's yield is unknown; never divided by a guess. */
  perServing?: Record<string, NutrientAmount>;
  servings: number;
  coverage: NutritionCoverage;
  ingredients: NutritionIngredient[];
  estimatedAt: string; // ISO-8601
}

/**
 * Grocery pricing (BL-0023 increment 1).
 *
 * Deliberately a separate contract from GroceryLine rather than fields on it:
 * price data has its own source, refresh cadence and legal constraints, and the
 * grocery list must keep working when pricing is unavailable.
 */

/** How stale the underlying price table is, graded when the estimate is made. */
export type PriceStaleness = "fresh" | "aging" | "stale";

/** Provenance for an estimate. A total shown without this is a number pretending to be a price. */
export interface PriceBasis {
  source: string;
  sourceUrl: string;
  /** Geographic basis of the averages, e.g. "U.S. city average". */
  area: string;
  /** "YYYY-MM" the prices were observed. */
  observationMonth: string;
  staleness: PriceStaleness;
}

/** Per-line outcome. Unpriced lines carry a reason and contribute nothing to the total. */
export interface PricedLine {
  canonicalItem: string;
  item: string;
  priced: boolean;
  cents?: number;
  /** Which coarse price bucket the ingredient resolved to. */
  bucket?: string;
  bucketLabel?: string;
  /** Why the line could not be priced, when `priced` is false. */
  reason?: string;
}

export interface CostEstimate {
  currency: string;
  totalCents: number;
  pricedCount: number;
  unpricedCount: number;
  lines: PricedLine[];
  basis: PriceBasis;
}

/**
 * Nutrition targets (BL-0038).
 *
 * A goal is a *constraint*, never a feature. "150 g of protein a day", "keep
 * cholesterol under 200 mg", "stay under 2,000 calories" and "low carb" differ
 * only in their field values, so one row shape and one evaluator serve all of
 * them — and serve goals nobody has asked for yet. There is deliberately no
 * `lowCarbMode` boolean anywhere in the system.
 */
export type NutritionTargetOperator = "<=" | ">=" | "==";

/**
 * The window a target is measured over. `meal` is a single serving of a single
 * recipe, which is what makes a "fits your goals" badge on a recipe possible
 * without inventing a second concept.
 */
export type NutritionTargetPeriod = "day" | "week" | "meal";

/** One constraint. A macro goal is three or four of these; a diet is one or two. */
export interface NutritionTarget {
  nutrientId: string;
  operator: NutritionTargetOperator;
  value: number;
  period: NutritionTargetPeriod;
  /** Optional user- or preset-supplied name, e.g. "Low cholesterol". */
  label?: string;
  /** Inactive targets are kept but never evaluated, so pausing a diet is not a delete. */
  active: boolean;
}

/**
 * `unknown` is not a failure mode, it is the honest answer when coverage is too
 * low to say. It must never collapse to `met`: a missing ingredient reading as
 * "under your limit" turns absent data into false reassurance on a health
 * screen, which is worse than showing nothing.
 */
export type NutritionTargetStatus = "met" | "under" | "over" | "unknown";

/** Why a target could not be evaluated. Present only when status is `unknown`. */
export type NutritionUnknownReason =
  /** No estimate at all — nothing planned, or the rollup has not loaded. */
  | "no-estimate"
  /** Too little of the food resolved for the total to mean anything. */
  | "low-coverage"
  /** The estimate resolved, but carries no amount for this nutrient. */
  | "nutrient-missing";

export interface NutritionTargetEvaluation {
  target: NutritionTarget;
  /** The measured amount, or null when the status is `unknown`. */
  actual: number | null;
  /** Unit of `actual`, from the estimate or the nutrient catalog. */
  unit: string | null;
  status: NutritionTargetStatus;
  reason?: NutritionUnknownReason;
  /** 0..1 of the underlying food that resolved, carried through for the UI. */
  coverage: number | null;
}

/**
 * A diet preset is a *bundle of target rows*, shipped as data. Adding "low
 * sodium" is an edit to a data file — no schema change, no evaluator branch, no
 * new code path.
 */
export interface DietPreset {
  id: string;
  label: string;
  description: string;
  targets: Array<Omit<NutritionTarget, "active">>;
}
