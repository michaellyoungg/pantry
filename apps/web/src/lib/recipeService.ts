import type { Recipe, CreateRecipeRequest } from "@pantry/types";

const BASE = (import.meta.env.VITE_RECIPE_SERVICE_URL as string) ?? "http://localhost:8090";

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

export async function deleteRecipe(id: string): Promise<void> {
  const res = await fetch(`${BASE}/recipes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteRecipe failed: ${res.status}`);
}

export async function updateRecipe(id: string, body: CreateRecipeRequest): Promise<Recipe> {
  const res = await fetch(`${BASE}/recipes/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updateRecipe failed: ${res.status}`);
  return (await res.json()) as Recipe;
}

export async function listCatalog(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/catalog`);
  if (!res.ok) throw new Error(`listCatalog failed: ${res.status}`);
  return (await res.json()) as Recipe[];
}
