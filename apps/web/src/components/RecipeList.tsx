import { useCallback, useEffect, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { deleteRecipe, listRecipes, updateRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { run, error, clearError } = useAsyncAction();

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
    <Card title="Recipes">
      {recipes.length === 0 && <p className="text-sm text-muted">No recipes yet.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <span className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}>
                Add to basket
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearError();
                  setEditing(r);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => onDelete(r)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />}
    </Card>
  );
}
