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
