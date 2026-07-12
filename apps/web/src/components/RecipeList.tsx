import { useCallback, useEffect, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const listRecipes = useAction(api.recipes.list);
  const deleteRecipe = useAction(api.recipes.remove);
  const updateRecipe = useAction(api.recipes.update);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { run, error, clearError, showError } = useAsyncAction();

  const refresh = useCallback(async () => {
    setRecipes(await listRecipes());
  }, [listRecipes]);

  useEffect(() => {
    let active = true;
    listRecipes()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [refreshKey, listRecipes]);

  // The recipe-service op is the source of truth. The Convex basket cleanup that
  // follows is best-effort: once the recipe is deleted/updated we must never let
  // a basket failure roll the UI back into an inconsistent state — always
  // refresh so the list reflects reality, and surface a targeted note instead.
  async function onDelete(r: Recipe) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    const deleted = await run(async () => {
      await deleteRecipe({ id: r.id });
      return true;
    });
    if (!deleted) return;
    try {
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
    } catch {
      showError(`Deleted "${r.title}", but couldn't update the basket — it may show a stale item until reload.`);
    }
    await refresh();
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[]) {
    if (!editing) return;
    const id = editing.id;
    const saved = await run(async () => {
      await updateRecipe({ id, title, ingredients });
      return true;
    });
    if (!saved) return;
    setEditing(null);
    try {
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
    } catch {
      showError(`Saved "${title}", but couldn't update the basket title — it may show the old title until reload.`);
    }
    await refresh();
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
