import { useEffect, useState } from "react";
import type { Recipe } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { listRecipes } from "../lib/recipeService";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const addToBasket = useMutation(api.basket.add);

  useEffect(() => {
    let active = true;
    listRecipes()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return (
    <div className="panel">
      <h2>Recipes</h2>
      {recipes.length === 0 && <p>No recipes yet.</p>}
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <button onClick={() => addToBasket({ recipeId: r.id, title: r.title })}>Add to basket</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
