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

export interface GroceryListRequest {
  recipeIds: string[];
}

export interface ImportRecipeRequest {
  url: string;
}
