import type { Ingredient } from "@pantry/types";

// The import-review draft: the state a recipe sits in between "parsed from a
// URL" (or typed by hand) and "saved". Every transition is a pure function of
// the previous draft, so the review flow can be tested without rendering it and
// reused by a client that draws it entirely differently.

export type RecipeDraft = {
  title: string;
  ingredients: Ingredient[];
  /** Ordered instruction lines (the method); empty for an ingredients-only recipe. */
  steps: string[];
  /** The URL being imported from; empty for a hand-typed recipe. */
  url: string;
};

/** What the parser hands back for review — a subset of `Recipe`. */
export type ImportedRecipe = { title: string; ingredients: Ingredient[]; steps?: string[] };

/** The payload a draft saves as. */
export type RecipeSubmission = { title: string; ingredients: Ingredient[]; steps: string[] };

/** The row the editor always shows at least one of, so there's a place to type. */
export function emptyIngredient(): Ingredient {
  return { quantity: 1, unit: "", item: "" };
}

export function emptyDraft(): RecipeDraft {
  return { title: "", ingredients: [emptyIngredient()], steps: [], url: "" };
}

/**
 * Adopt a parsed recipe for review. An import that yielded no ingredients still
 * leaves one blank row, so the reviewer has somewhere to type rather than an
 * empty editor.
 */
export function withImportedRecipe(draft: RecipeDraft, imported: ImportedRecipe): RecipeDraft {
  return {
    ...draft,
    title: imported.title,
    ingredients: imported.ingredients.length ? imported.ingredients : [emptyIngredient()],
    steps: imported.steps ?? [],
  };
}

export function withSteps(draft: RecipeDraft, steps: string[]): RecipeDraft {
  return { ...draft, steps };
}

export function withIngredientPatch(
  draft: RecipeDraft,
  index: number,
  patch: Partial<Ingredient>,
): RecipeDraft {
  return {
    ...draft,
    ingredients: draft.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
  };
}

export function withExtraIngredient(draft: RecipeDraft): RecipeDraft {
  return { ...draft, ingredients: [...draft.ingredients, emptyIngredient()] };
}

/**
 * The payload to save, or `null` when the draft isn't submittable. Blank
 * ingredient rows and blank step lines are dropped rather than rejected — they
 * are scaffolding for typing, not user intent.
 */
export function draftSubmission(draft: RecipeDraft): RecipeSubmission | null {
  const title = draft.title.trim();
  if (!title) return null;
  return {
    title,
    ingredients: draft.ingredients.filter((ing) => ing.item.trim() !== ""),
    steps: draft.steps.map((step) => step.trim()).filter((step) => step !== ""),
  };
}

/** The URL to import, or `null` when there's nothing to import. */
export function draftImportUrl(draft: RecipeDraft): string | null {
  const url = draft.url.trim();
  return url ? url : null;
}
