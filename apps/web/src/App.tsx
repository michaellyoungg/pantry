import { useState } from "react";
import { Basket } from "./components/Basket";
import { GroceryList } from "./components/GroceryList";
import { RecipeForm } from "./components/RecipeForm";
import { RecipeList } from "./components/RecipeList";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <span className="text-2xl" aria-hidden>
            🥕
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-text">Pantry</h1>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
          <RecipeList refreshKey={refreshKey} />
          <Basket />
          <GroceryList />
        </div>
      </main>
    </div>
  );
}
