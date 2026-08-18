import { api } from "@pantry/convex/api";
import type { EquipmentDef, PrepTask, PrepTaskInput, Recipe } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useRef } from "react";
import { formatTotalMinutes, parseTotalMinutes } from "../discovery";
import { useAsyncAction } from "../react/useAsyncAction";
import { useRecipeDraft } from "../react/useRecipeDraft";
import { formatServings, parseServings } from "../servings";
import { type ListEquipmentDefs, useEquipmentCatalog } from "./useEquipmentCatalog";
import type { UpdateRecipe } from "./useMyRecipes";
import { type GetRecipe, useRecipeDetail } from "./useRecipeDetail";

/** `recipes.create`. Injectable so web can pass its traced wrapper. */
export type CreateRecipe = (
  args: FunctionArgs<typeof api.recipes.create>,
) => Promise<FunctionReturnType<typeof api.recipes.create>>;

/** `recipes.importFromUrl`. Injectable for the same reason. */
export type ImportFromUrl = (
  args: FunctionArgs<typeof api.recipes.importFromUrl>,
) => Promise<FunctionReturnType<typeof api.recipes.importFromUrl>>;

export type UseRecipeEditor = ReturnType<typeof useRecipeDraft> & {
  /** Whether this editor is creating a recipe or rewriting a stored one. */
  mode: "create" | "edit";
  /** The equipment catalog, for the picker. */
  equipment: EquipmentDef[];
  /**
   * What this recipe currently derives (BL-0044), so an unhelpful rule can be
   * overridden rather than worked around. Empty while creating: a recipe that
   * does not exist yet has nothing to derive against.
   */
  derivedPrep: PrepTask[];
  /** True until a recipe being edited has arrived. Always false when creating. */
  loading: boolean;
  /** The id resolved to no recipe — an ordinary state, not a failure. */
  missing: boolean;
  /** A failed load of the recipe being edited. */
  loadError: string | null;
  importing: boolean;
  importError: string | null;
  /**
   * Pull a recipe off the typed URL into the draft. NEVER saves: the review
   * step is the whole point of the funnel (BL-0020), and a wrong guess is
   * corrected here rather than after the fact.
   */
  importRecipe: () => Promise<void>;
  /** True once the draft has enough to save. */
  canSave: boolean;
  saving: boolean;
  /** A failed save, already stringified. */
  error: string | null;
  /** Create or update. Resolves to the saved recipe's id, or null on failure. */
  save: () => Promise<string | null>;
};

/**
 * The one review-and-edit surface (BL-0020), with no view attached.
 *
 * Four entry points, one screen: manual entry, URL import, and — through
 * `recipeId` — editing something already saved. That rule is the reason a
 * parse is never stored silently; it lands in the draft and the cook confirms
 * it. Which is also why import and save are separate actions here rather than
 * one "import" button that writes.
 *
 * The draft and its transitions are `useRecipeDraft` from `@pantry/core/react`,
 * unchanged; this hook adds the three Convex writes, the equipment catalog the
 * picker needs, and — when editing — the stored recipe to seed from and the
 * prep this recipe derives.
 */
export function useRecipeEditor(
  recipeId?: string,
  {
    createRecipe,
    importFromUrl,
    updateRecipe,
    getRecipe,
    listEquipment,
  }: {
    createRecipe?: CreateRecipe;
    importFromUrl?: ImportFromUrl;
    updateRecipe?: UpdateRecipe;
    getRecipe?: GetRecipe;
    listEquipment?: ListEquipmentDefs;
  } = {},
): UseRecipeEditor {
  const createAction = useAction(api.recipes.create);
  const importAction = useAction(api.recipes.importFromUrl);
  const updateAction = useAction(api.recipes.update);
  const create = createRecipe ?? createAction;
  const importUrlAction = importFromUrl ?? importAction;
  const update = updateRecipe ?? updateAction;
  const updateBasketTitle = useMutation(api.basket.updateTitle);

  const editor = useRecipeDraft();
  const { seed, applyImported, submission } = editor;
  const { catalog: equipment } = useEquipmentCatalog({ listEquipment });
  const { run, error, pending: saving } = useAsyncAction();
  const importer = useAsyncAction();

  // Only fetched when editing. `useRecipeDetail` needs an id, so a create-mode
  // editor passes the empty string and is short-circuited by `enabled` below —
  // rules of hooks mean it cannot simply not be called.
  const detail = useRecipeDetail(recipeId ?? "", { getRecipe, enabled: recipeId !== undefined });

  // Seeded once. Re-seeding on every render of an unchanged recipe would
  // discard whatever the user has typed since, which is the one thing an edit
  // form must never do.
  const seededId = useRef<string | null>(null);
  const stored = detail.recipe;
  useEffect(() => {
    if (recipeId === undefined || stored === undefined) return;
    if (seededId.current === recipeId) return;
    seededId.current = recipeId;
    seed(stored);
  }, [recipeId, stored, seed]);

  const importRecipe = useCallback(async () => {
    const url = editor.importUrl;
    if (url === null) return;
    const preview = (await importer.run(() => importUrlAction({ url }))) as Recipe | undefined;
    // A failed import leaves the draft exactly as it was — whatever the cook has
    // already typed survives a page that would not parse. `importer.error` says
    // what happened.
    if (preview === undefined) return;
    // The import fills in whatever the page stated and leaves the rest blank
    // for the cook to supply. Equipment, methods, cuisine and cook time arrive
    // already guessed; the fields below are where a wrong guess is corrected
    // before saving — never saved silently.
    applyImported({
      ...preview,
      servings: formatServings(preview.servings),
      totalMinutes: formatTotalMinutes(preview.totalMinutes),
      tags: preview.tags ?? [],
      cuisine: preview.cuisine ?? "",
      sourceUrl: preview.sourceUrl ?? "",
      // A preview can only carry storable prep — the importer's model tagging
      // produces `llm` tasks. Rule-derived prep is computed on read and never
      // stored, so anything claiming to be one is dropped rather than saved
      // back as a frozen copy of a rule that may since have changed.
      prepTasks: (preview.prepTasks ?? []).flatMap<PrepTaskInput>((task) =>
        task.source === "rule"
          ? []
          : [{ key: task.key, window: task.window, text: task.text, source: task.source }],
      ),
    });
  }, [editor.importUrl, importer, importUrlAction, applyImported]);

  const save = useCallback(async () => {
    if (submission === null) return null;
    const fields = {
      title: submission.title,
      servings: parseServings(submission.servings),
      ingredients: submission.ingredients,
      steps: submission.steps,
      equipment: submission.equipment,
      methods: submission.methods,
      cuisine: submission.cuisine,
      totalMinutes: parseTotalMinutes(submission.totalMinutes),
      tags: submission.tags,
      // Attribution survives the review step, so an imported recipe keeps a
      // link back to where it came from and can be re-imported later.
      sourceUrl: submission.sourceUrl || undefined,
      prepTasks: submission.prepTasks,
    };

    if (recipeId === undefined) {
      const created = await run(() => create(fields));
      return created?.id ?? null;
    }

    // update REPLACES the recipe, so every field goes every time — an omitted
    // one clears the stored value.
    const saved = await run(async () => {
      await update({ id: recipeId, ...fields });
      return true;
    });
    if (saved !== true) return null;
    // Best-effort, and deliberately after the source-of-truth write: a basket
    // that still shows the old title is a smaller problem than an edit that
    // appears to have failed.
    await updateBasketTitle({ recipeId, title: fields.title }).catch(() => undefined);
    return recipeId;
  }, [submission, recipeId, run, create, update, updateBasketTitle]);

  return {
    ...editor,
    mode: recipeId === undefined ? "create" : "edit",
    equipment,
    // Only what this recipe DERIVES is offered for override; a task the cook
    // already wrote is in the draft above, and showing it twice would suggest
    // the override did not take.
    derivedPrep: detail.prepTasks.filter((task) => task.source !== "manual"),
    loading: recipeId !== undefined && detail.loading,
    missing: recipeId !== undefined && detail.missing,
    loadError: detail.error,
    importing: importer.pending,
    importError: importer.error,
    importRecipe,
    canSave: submission !== null,
    saving,
    error,
    save,
  };
}
