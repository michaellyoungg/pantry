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
