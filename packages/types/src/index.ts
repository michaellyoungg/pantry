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
