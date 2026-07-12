import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";
import { Catalog } from "../components/Catalog";
import { Basket } from "../components/Basket";
import { GroceryList } from "../components/GroceryList";

function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
        <RecipeList refreshKey={refreshKey} />
        <Catalog />
        <Basket />
        <GroceryList />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
