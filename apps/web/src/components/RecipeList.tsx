import { api } from "@pantry/convex/api";
import { defaultServingsMultiplier } from "@pantry/core";
import { addToBasketOptimistic, removeFromBasketOptimistic } from "@pantry/core/convex";
import { useAsyncAction, useAsyncData } from "@pantry/core/react";
import type {
  CookingMethod,
  Ingredient,
  PrepTaskInput,
  Recipe,
  RecipeEquipment,
} from "@pantry/types";
import { useMutation } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { useEquipmentCatalog } from "../lib/useEquipmentCatalog";
import { useHouseholdSize } from "../lib/useHouseholdSize";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { RecipeNutrition } from "./RecipeNutrition";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/useConfirm";

export function RecipeList({
  refreshKey,
  openRecipeId,
}: {
  refreshKey: number;
  /** Start this recipe expanded — how `/recipes?recipe=<id>` lands on one. */
  openRecipeId?: string;
}) {
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [showNutrition, setShowNutrition] = useState<string | null>(null);
  const listRecipes = useTracedAction(api.recipes.list, "recipes.list");
  const deleteRecipe = useTracedAction(api.recipes.remove, "recipes.remove");
  const updateRecipe = useTracedAction(api.recipes.update, "recipes.update");
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
  const householdSize = useHouseholdSize();
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
  // The equipment catalog is reference data: load it once here and pass it to
  // every row rather than having each RecipeDetails fetch its own copy.
  const { catalog } = useEquipmentCatalog();
  const recipes = data ?? [];

  // De-dup (BL-0013): duplicate titles stay LEGAL. Importing the same page
  // twice, or keeping two takes on "Chili", is normal and blocking the write
  // would be worse than the mess. So the fix is visibility, not a constraint —
  // flag the collisions and let the user prune them with Edit/Delete.
  // Normalized on trim + case so "Garlic Bread" and "garlic bread " collide.
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes) {
      const key = r.title.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
  }, [recipes]);

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

  async function onSaveEdit(
    title: string,
    servings: number | undefined,
    ingredients: Ingredient[],
    steps: string[],
    equipment: RecipeEquipment[],
    methods: CookingMethod[],
    prepTasks: PrepTaskInput[],
  ) {
    if (!editing) return;
    const id = editing.id;
    const saved = await run(async () => {
      // update replaces the whole recipe, so servings must be sent every time —
      // omitting it clears the stored yield.
      await updateRecipe({
        id,
        title,
        servings,
        ingredients,
        steps,
        equipment,
        methods,
        prepTasks,
      });
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
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-text">{r.title}</span>
                {duplicateTitles.has(r.title.trim().toLowerCase()) && (
                  <span
                    className="shrink-0 rounded-full bg-border px-2 py-0.5 text-xs text-muted"
                    title="Another recipe has this title — edit or delete one to clean up"
                  >
                    Duplicate
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    run(() =>
                      addToBasket({
                        recipeId: r.id,
                        title: r.title,
                        servingsMultiplier: defaultServingsMultiplier(householdSize, r.servings),
                      }),
                    )
                  }
                >
                  Add to basket
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showNutrition === r.id}
                  onClick={() => setShowNutrition(showNutrition === r.id ? null : r.id)}
                >
                  Nutrition
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
            <RecipeDetails recipe={r} catalog={catalog} open={r.id === openRecipeId} />
            {/* Estimated on demand: it is a per-recipe network round trip, so it
                loads when asked for rather than for every row in the list. */}
            {showNutrition === r.id && <RecipeNutrition recipeId={r.id} />}
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && (
        <RecipeEditDialog
          recipe={editing}
          catalog={catalog}
          onSave={onSaveEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDialog}
    </Card>
  );
}
