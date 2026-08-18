import { api } from "@pantry/convex/api";
import { type RecipeEdit, useEquipmentCatalog, useMyRecipes } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import type { Recipe } from "@pantry/types";
import { useEffect, useRef, useState } from "react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { RecipeNutrition } from "./RecipeNutrition";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/useConfirm";

/**
 * "My recipes" (BL-0013): presentation over `useMyRecipes()`.
 *
 * The list request, the three writes and the best-effort basket reconciliation
 * each of them needs afterwards live in `@pantry/core/data`, so the native list
 * cannot come to different conclusions about the same collection. Confirmation
 * and the edit dialog stay here — they are the platform's, not the domain's.
 */
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
  const {
    recipes,
    loading,
    loadError,
    error,
    isDuplicate,
    addToBasket,
    remove,
    save,
    reload,
    clearError,
  } = useMyRecipes({
    listRecipes: useTracedAction(api.recipes.list, "recipes.list"),
    removeRecipe: useTracedAction(api.recipes.remove, "recipes.remove"),
    updateRecipe: useTracedAction(api.recipes.update, "recipes.update"),
  });
  const { confirm, confirmDialog } = useConfirm();
  // The equipment catalog is reference data: load it once here and pass it to
  // every row rather than having each RecipeDetails fetch its own copy.
  const { catalog } = useEquipmentCatalog({
    listEquipment: useTracedAction(api.recipes.listEquipment, "recipes.listEquipment"),
  });

  // The create form beside this list writes through a different action, so a
  // new recipe only reaches here when it says so. Compared against the last
  // value rather than run on every change, so mounting does not immediately
  // re-request what `useMyRecipes` is already fetching.
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    reload();
  }, [refreshKey, reload]);

  async function onDelete(r: Recipe) {
    const confirmed = await confirm({
      title: `Delete "${r.title}"?`,
      confirmLabel: "Delete recipe",
      destructive: true,
    });
    if (!confirmed) return;
    await remove(r);
  }

  async function onSaveEdit(edit: RecipeEdit) {
    if (!editing) return;
    if (await save(editing.id, edit)) setEditing(null);
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
      {/* Named so tests (and screen readers) can tell this list apart from the
          "For you" suggestions rendered directly above it on /recipes, which
          list the same recipe titles. */}
      <ul aria-label="My recipes" className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li
            key={r.id}
            data-testid={TEST_IDS.recipes.item(r.title)}
            className="flex flex-col gap-1.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-text">{r.title}</span>
                {/* De-dup (BL-0013): duplicate titles stay LEGAL. The fix is
                    visibility, not a constraint — flag the collisions and let
                    the user prune them with Edit/Delete. */}
                {isDuplicate(r) && (
                  <span
                    className="shrink-0 rounded-full bg-border px-2 py-0.5 text-xs text-muted"
                    title="Another recipe has this title — edit or delete one to clean up"
                  >
                    Duplicate
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => addToBasket(r)}>
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
                  data-testid={TEST_IDS.recipes.edit(r.title)}
                  onClick={() => {
                    clearError();
                    setEditing(r);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  data-testid={TEST_IDS.recipes.remove(r.title)}
                  onClick={() => onDelete(r)}
                >
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
