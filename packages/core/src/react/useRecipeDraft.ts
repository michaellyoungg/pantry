import type {
  CookingMethod,
  Ingredient,
  PrepTaskInput,
  Recipe,
  RecipeEquipment,
} from "@pantry/types";
import { useCallback, useMemo, useState } from "react";
import {
  draftFromRecipe,
  draftImportUrl,
  draftSubmission,
  emptyDraft,
  type ImportedRecipe,
  type RecipeDraft,
  withCuisine,
  withEquipment,
  withExtraIngredient,
  withImportedRecipe,
  withIngredientPatch,
  withIngredients,
  withMethods,
  withPrepTasks,
  withServings,
  withSteps,
  withTags,
  withTotalMinutes,
} from "../recipeDraft";

/**
 * Headless import-review state: holds a `RecipeDraft` and exposes the pure
 * transitions from `recipeDraft.ts` as callbacks. No DOM, no styling — a client
 * supplies the fields and buttons.
 */
export function useRecipeDraft() {
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft);

  const setTitle = useCallback((title: string) => setDraft((d) => ({ ...d, title })), []);
  const setUrl = useCallback((url: string) => setDraft((d) => ({ ...d, url })), []);
  const updateIngredient = useCallback(
    (index: number, patch: Partial<Ingredient>) =>
      setDraft((d) => withIngredientPatch(d, index, patch)),
    [],
  );
  const addIngredient = useCallback(() => setDraft((d) => withExtraIngredient(d)), []);
  const setIngredients = useCallback(
    (ingredients: Ingredient[]) => setDraft((d) => withIngredients(d, ingredients)),
    [],
  );
  const setSteps = useCallback((steps: string[]) => setDraft((d) => withSteps(d, steps)), []);
  const setServings = useCallback(
    (servings: string) => setDraft((d) => withServings(d, servings)),
    [],
  );
  const setEquipment = useCallback(
    (equipment: RecipeEquipment[]) => setDraft((d) => withEquipment(d, equipment)),
    [],
  );
  const setMethods = useCallback(
    (methods: CookingMethod[]) => setDraft((d) => withMethods(d, methods)),
    [],
  );
  const setCuisine = useCallback((cuisine: string) => setDraft((d) => withCuisine(d, cuisine)), []);
  const setTotalMinutes = useCallback(
    (totalMinutes: string) => setDraft((d) => withTotalMinutes(d, totalMinutes)),
    [],
  );
  const setTags = useCallback((tags: string[]) => setDraft((d) => withTags(d, tags)), []);
  const setPrepTasks = useCallback(
    (prepTasks: PrepTaskInput[]) => setDraft((d) => withPrepTasks(d, prepTasks)),
    [],
  );
  const applyImported = useCallback(
    (imported: ImportedRecipe) => setDraft((d) => withImportedRecipe(d, imported)),
    [],
  );
  const reset = useCallback(() => setDraft(emptyDraft()), []);
  // Editing an existing recipe is the same review surface with a different
  // starting point, so it seeds the same draft rather than getting a second
  // one. A callback rather than an initial value because the recipe is fetched:
  // the editor mounts before it arrives.
  const seed = useCallback((recipe: Recipe) => setDraft(draftFromRecipe(recipe)), []);

  const submission = useMemo(() => draftSubmission(draft), [draft]);
  const importUrl = useMemo(() => draftImportUrl(draft), [draft]);

  return {
    draft,
    setTitle,
    setUrl,
    updateIngredient,
    addIngredient,
    setIngredients,
    setSteps,
    setServings,
    setEquipment,
    setMethods,
    setCuisine,
    setTotalMinutes,
    setTags,
    setPrepTasks,
    applyImported,
    reset,
    seed,
    /** The payload to save, or `null` while the draft isn't submittable. */
    submission,
    /** The URL to import, or `null` when the field is blank. */
    importUrl,
  };
}
