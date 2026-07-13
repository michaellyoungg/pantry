import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";

function MyRecipes() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
      <RecipeList refreshKey={refreshKey} />
    </div>
  );
}

export const Route = createFileRoute("/recipes/")({ component: MyRecipes });
