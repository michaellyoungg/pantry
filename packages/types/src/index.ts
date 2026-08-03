export interface Ingredient {
  quantity: number;
  unit: string;
  item: string;
  note?: string;
}

/**
 * The closed cooking-method enum (BL-0041). Closed on purpose: BL-0042's prep
 * rules key on these values, and rules cannot be written against a vocabulary
 * that varies per recipe. recipe-service is the source of truth
 * (`internal/recipe/equipment.json`); this list mirrors it.
 */
export const COOKING_METHODS = [
  "bake",
  "roast",
  "grill",
  "smoke",
  "sous_vide",
  "slow_cook",
  "pressure_cook",
  "fry",
  "saute",
  "boil",
  "marinate",
  "no_cook",
] as const;

export type CookingMethod = (typeof COOKING_METHODS)[number];

/**
 * Display labels for the method enum. Typed as a total Record so adding a
 * method to COOKING_METHODS without a label fails to compile.
 */
export const COOKING_METHOD_LABELS: Record<CookingMethod, string> = {
  bake: "Bake",
  roast: "Roast",
  grill: "Grill",
  smoke: "Smoke",
  sous_vide: "Sous vide",
  slow_cook: "Slow cook",
  pressure_cook: "Pressure cook",
  fry: "Fry",
  saute: "Sauté",
  boil: "Boil",
  marinate: "Marinate",
  no_cook: "No-cook",
};

export type EquipmentCategory = "appliance" | "cookware" | "tool";

/** One entry of the curated hardware catalog served by GET /equipment. */
export interface EquipmentDef {
  id: string;
  name: string;
  category: EquipmentCategory;
  aliases: string[];
}

/**
 * An equipment tag on a recipe, referencing the catalog by slug.
 * `required: false` is "a grill pan works too" — optional gear must not block
 * BL-0043's "can I make this?" check.
 */
export interface RecipeEquipment {
  id: string;
  required: boolean;
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
  /** Equipment tags referencing the catalog. Empty when nothing was detected. */
  equipment: RecipeEquipment[];
  /** Members of the closed method enum. Empty when nothing was detected. */
  methods: CookingMethod[];
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
  equipment?: RecipeEquipment[];
  methods?: CookingMethod[];
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
