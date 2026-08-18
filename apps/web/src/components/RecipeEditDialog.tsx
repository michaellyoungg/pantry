import { api } from "@pantry/convex/api";
import {
  formatTags,
  formatTotalMinutes,
  parseTags,
  parseTotalMinutes,
  toISODate,
} from "@pantry/core";
import { useAsyncData } from "@pantry/core/react";
import type { EquipmentDef, PrepTaskInput, Recipe } from "@pantry/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatServings, parseServings } from "../lib/servings";
import { useTracedAction } from "../telemetry/useTracedAction";
import { emptyIngredient, RecipeFields, type RecipeFieldsValue } from "./RecipeFields";
import { Button } from "./ui/Button";

/**
 * What the dialog hands back on save. An object rather than a positional
 * argument list: with ten fields, a caller mixing up two adjacent strings is a
 * bug the compiler cannot see.
 */
export interface RecipeEdit {
  title: string;
  servings: number | undefined;
  ingredients: Recipe["ingredients"];
  steps: string[];
  equipment: Recipe["equipment"];
  methods: Recipe["methods"];
  cuisine: string;
  totalMinutes: number | undefined;
  tags: string[];
  sourceUrl: string | undefined;
  /**
   * The user's own prep tasks (BL-0044). Unlike every field above this does not
   * replace the recipe's whole prep — model-derived tasks are a separate
   * producer and survive an edit untouched.
   */
  prepTasks: PrepTaskInput[];
}

export function RecipeEditDialog({
  recipe,
  catalog,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  catalog: EquipmentDef[];
  onSave: (edit: RecipeEdit) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Seeded from the stored recipe so saving an unrelated edit does not clear
  // the rest — update replaces the whole recipe, so anything not sent is lost.
  const [fields, setFields] = useState<RecipeFieldsValue>(() => ({
    title: recipe.title,
    servings: formatServings(recipe.servings),
    ingredients: recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
    steps: recipe.steps ?? [],
    equipment: recipe.equipment ?? [],
    methods: recipe.methods ?? [],
    cuisine: recipe.cuisine ?? "",
    totalMinutes: formatTotalMinutes(recipe.totalMinutes),
    tags: formatTags(recipe.tags),
    // Only the user's own tasks are editable here. Model-derived ones are
    // stored too but are not this form's to rewrite — they are offered for
    // override below, like rule-derived ones, which is what keeps provenance
    // honest.
    prepTasks: (recipe.prepTasks ?? [])
      .filter((task) => task.source === "manual")
      .map((task) => ({ key: task.key, window: task.window, text: task.text })),
  }));
  const [busy, setBusy] = useState(false);

  // What this recipe currently derives, so a rule the user disagrees with can
  // be overridden rather than merely worked around. A recipe being edited has
  // no cook date, so today stands in and the resolved dates are never shown.
  const forRecipe = useTracedAction(api.prepTasks.forRecipe, "prepTasks.forRecipe");
  const cookDate = toISODate(new Date());
  const loadPrep = useCallback(
    () => forRecipe({ recipeId: recipe.id, cookDate }),
    [forRecipe, recipe.id, cookDate],
  );
  const { data: derivedPrep } = useAsyncData(loadPrep);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.title.trim()) return;
    setBusy(true);
    try {
      await onSave({
        title: fields.title.trim(),
        servings: parseServings(fields.servings),
        ingredients: fields.ingredients.filter((ing) => ing.item.trim() !== ""),
        steps: fields.steps.map((s) => s.trim()).filter((s) => s !== ""),
        equipment: fields.equipment,
        methods: fields.methods,
        cuisine: fields.cuisine.trim(),
        totalMinutes: parseTotalMinutes(fields.totalMinutes),
        tags: parseTags(fields.tags),
        // Attribution is not editable here, but it must be echoed back or the
        // wholesale update would silently drop where the recipe came from.
        sourceUrl: recipe.sourceUrl,
        prepTasks: fields.prepTasks,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Edit recipe</h2>
        <RecipeFields
          value={fields}
          onChange={(patch) => setFields((prev) => ({ ...prev, ...patch }))}
          catalog={catalog}
          derivedPrep={derivedPrep?.tasks ?? []}
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
