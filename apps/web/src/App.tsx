import { useState } from "react";
import { RecipeForm } from "./components/RecipeForm";
import { RecipeList } from "./components/RecipeList";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <main className="container">
      <h1>Pantry</h1>
      <div className="grid">
        <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
        <RecipeList refreshKey={refreshKey} />
      </div>
    </main>
  );
}
