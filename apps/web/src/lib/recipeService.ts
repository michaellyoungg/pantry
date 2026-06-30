import type { Recipe, CreateRecipeRequest } from "@pantry/types";

const BASE = (import.meta.env.VITE_RECIPE_SERVICE_URL as string) ?? "http://localhost:8080";

export async function createRecipe(body: CreateRecipeRequest): Promise<Recipe> {
  const res = await fetch(`${BASE}/recipes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createRecipe failed: ${res.status}`);
  return (await res.json()) as Recipe;
}

export async function listRecipes(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/recipes`);
  if (!res.ok) throw new Error(`listRecipes failed: ${res.status}`);
  return (await res.json()) as Recipe[];
}
