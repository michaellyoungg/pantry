import { api } from "@pantry/convex/api";
import type { Ingredient, Recipe } from "@pantry/types";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { addToBasketOptimistic, removeFromBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useAsyncData } from "../lib/useAsyncData";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/useConfirm";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [editing, setEditing] = useState<Recipe | null>(null);
  const listRecipes = useTracedAction(api.recipes.list, "recipes.list");
  const deleteRecipe = useTracedAction(api.recipes.remove, "recipes.remove");
  const updateRecipe = useTracedAction(api.recipes.update, "recipes.update");
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  // Convex actions require an args object; pass an empty traceCtx-less one. Wrap in
  // useCallback so useAsyncData's effect (keyed on fn) doesn't refire every render.
  const load = useCallback(() => listRecipes({}), [listRecipes]);
  const { data, loading, error: loadError, reload } = useAsyncData(load, [refreshKey]);
  const { run, error, clearError, showError } = useAsyncAction();
  const { confirm, confirmDialog } = useConfirm();
  const recipes = data ?? [];

  // The recipe-service op is the source of truth. The Convex basket cleanup that
  // follows is best-effort: once the recipe is deleted/updated we must never let
  // a basket failure roll the UI back into an inconsistent state — always reload
  // so the list reflects reality, and surface a targeted note instead.
  async function onDelete(r: Recipe) {
    const confirmed = await confirm({
      title: `Delete "${r.title}"?`,
      confirmLabel: "Delete recipe",
      destructive: true,
    });
    if (!confirmed) return;
    const deleted = await run(async () => {
      await deleteRecipe({ id: r.id });
      return true;
    });
    if (!deleted) return;
    try {
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
    } catch {
      showError(
        `Deleted "${r.title}", but couldn't update the basket — it may show a stale item until reload.`,
      );
    }
    reload();
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[], steps: string[]) {
    if (!editing) return;
    const id = editing.id;
    const saved = await run(async () => {
      await updateRecipe({ id, title, ingredients, steps });
      return true;
    });
    if (!saved) return;
    setEditing(null);
    try {
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
    } catch {
      showError(
        `Saved "${title}", but couldn't update the basket title — it may show the old title until reload.`,
      );
    }
    reload();
  }

  return (
    <Card title="Recipes">
      {loading && recipes.length === 0 && <p className="text-sm text-muted">Loading recipes…</p>}
      {loadError && (
        <div className="flex items-center gap-2">
          <ErrorText message={loadError} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && recipes.length === 0 && (
        <p className="text-sm text-muted">No recipes yet.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{r.title}</span>
              <span className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
                >
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
            </div>
            <RecipeDetails recipe={r} />
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && (
        <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />
      )}
      {confirmDialog}
    </Card>
  );
}
