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
  ingredients: Ingredient[];
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

/** One pantry row as the recommender sees it. Mirrors Go recommend.PantryItem. */
export interface PantryContextItem {
  canonicalItem: string;
  state: "have" | "low" | "out";
  useItUp?: boolean;
}

/** Ingredient-grounded preferences. `avoidItems` is a hard filter, not a weight. */
export interface RecommendationPreferences {
  avoidItems: string[];
  likedItems: string[];
  dislikedItems: string[];
}

/** Mirrors Go recommend.UserContext. */
export interface RecommendationRequest {
  pantry: PantryContextItem[];
  preferences: RecommendationPreferences;
  affinities?: Record<string, number>;
  savedRecipeIds?: string[];
  excludeRecipeIds?: string[];
  limit?: number;
}

export interface RecommendationMissingItem {
  canonicalItem: string;
  display: string;
}

/** Mirrors Go recommend.Result. */
export interface Recommendation {
  recipeId: string;
  title: string;
  /** "generated" is reserved for a future LLM candidate provider (BL-0034). */
  source: "catalog" | "user" | "generated";
  score: number;
  reasons: string[];
  have: string[];
  missing: RecommendationMissingItem[];
}

export interface RecommendationResponse {
  results: Recommendation[];
}
