import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ForYou } from "../components/ForYou";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";

function MyRecipes() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { recipe } = Route.useSearch();
  return (
    <div className="flex flex-col gap-6">
      {/* Discovery sits ABOVE the collection, and above the add form. The
          question "what should I try" is answered by looking outward, and
          burying it under a list of what you already have would make it a
          footnote to the opposite question (BL-0005 increment 2). */}
      <ForYou />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
        <RecipeList refreshKey={refreshKey} openRecipeId={recipe} />
      </div>
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
