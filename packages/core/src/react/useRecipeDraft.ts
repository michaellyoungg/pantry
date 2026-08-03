import type { Ingredient } from "@pantry/types";
import { useCallback, useMemo, useState } from "react";
import {
  draftImportUrl,
  draftSubmission,
  emptyDraft,
  type ImportedRecipe,
  type RecipeDraft,
  withExtraIngredient,
  withImportedRecipe,
  withIngredientPatch,
  withSteps,
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
  const setSteps = useCallback((steps: string[]) => setDraft((d) => withSteps(d, steps)), []);
  const applyImported = useCallback(
    (imported: ImportedRecipe) => setDraft((d) => withImportedRecipe(d, imported)),
    [],
  );
  const reset = useCallback(() => setDraft(emptyDraft()), []);

  const submission = useMemo(() => draftSubmission(draft), [draft]);
  const importUrl = useMemo(() => draftImportUrl(draft), [draft]);

  return {
    draft,
    setTitle,
    setUrl,
    updateIngredient,
    addIngredient,
    setSteps,
    applyImported,
    reset,
    /** The payload to save, or `null` while the draft isn't submittable. */
    submission,
    /** The URL to import, or `null` when the field is blank. */
    importUrl,
  };
}
