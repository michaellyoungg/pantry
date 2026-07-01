import { useCallback, useEffect, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { deleteRecipe, listRecipes, updateRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { RecipeEditDialog } from "./RecipeEditDialog";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { run, error } = useAsyncAction();

  const refresh = useCallback(async () => {
    setRecipes(await listRecipes());
  }, []);

  useEffect(() => {
    let active = true;
    listRecipes()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function onDelete(r: Recipe) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    await run(async () => {
      await deleteRecipe(r.id);
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
      await refresh();
    });
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[]) {
    if (!editing) return;
    const id = editing.id;
    const ok = await run(async () => {
      await updateRecipe(id, { title, ingredients });
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
      await refresh();
      return true;
    });
    if (ok) setEditing(null);
  }

  return (
    <div className="panel">
      <h2>Recipes</h2>
      {recipes.length === 0 && <p>No recipes yet.</p>}
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <span>
              <button onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}>Add to basket</button>
              <button onClick={() => setEditing(r)}>Edit</button>
              <button onClick={() => onDelete(r)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && (
        <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
