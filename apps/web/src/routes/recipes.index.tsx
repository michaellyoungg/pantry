import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";

function MyRecipes() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { recipe } = Route.useSearch();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
      <RecipeList refreshKey={refreshKey} openRecipeId={recipe} />
    </div>
  );
}

export const Route = createFileRoute("/recipes/")({
  component: MyRecipes,
  // `?recipe=<id>` opens the list on one recipe. The grocery list's provenance
  // sheet links here, so "which recipe wanted this?" ends on the recipe rather
  // than on a page the user then has to search.
  validateSearch: (search: Record<string, unknown>): { recipe?: string } => ({
    recipe: typeof search.recipe === "string" ? search.recipe : undefined,
  }),
});
