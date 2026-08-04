import type { CookingMethod, Ingredient, RecipeEquipment } from "@pantry/types";

// The import-review draft: the state a recipe sits in between "parsed from a
// URL" (or typed by hand) and "saved". Every transition is a pure function of
// the previous draft, so the review flow can be tested without rendering it and
// reused by a client that draws it entirely differently.

export type RecipeDraft = {
  title: string;
  /**
   * The yield field as typed, not as stored: blank means "unknown" and junk
   * stays junk until the client parses it. Keeping it raw is what lets this
   * package stay ignorant of a client's input widget and of the wire format.
   */
  servings: string;
  ingredients: Ingredient[];
  /** Ordered instruction lines (the method); empty for an ingredients-only recipe. */
  steps: string[];
  /**
   * Equipment tags referencing the service's curated catalog by slug, and the
   * closed cooking-method enum (BL-0041). Import guesses both from the step
   * text, so they arrive in the draft precisely to be corrected before saving.
   */
  equipment: RecipeEquipment[];
  methods: CookingMethod[];
  /**
   * Discovery metadata (BL-0020). `cuisine` and `tags` are free text here and
   * are slugified server-side, so the draft never has to know the vocabulary.
   * `totalMinutes` is raw field text for the same reason `servings` is: blank
   * means unknown, and parsing belongs to the client that owns the widget.
   */
  cuisine: string;
  totalMinutes: string;
  tags: string[];
  /**
   * Where the recipe came from, for attribution and re-import. Filled in by an
   * import and then carried through the save. Distinct from `url`, which is
   * whatever is currently typed in the import box — that one is scratch input,
   * this one is the provenance of the recipe being reviewed.
   */
  sourceUrl: string;
  /** The URL being imported from; empty for a hand-typed recipe. */
  url: string;
};

/** What the parser hands back for review — a subset of `Recipe`. */
export type ImportedRecipe = {
  title: string;
  ingredients: Ingredient[];
  steps?: string[];
  /** Already rendered for the field; blank when the import found no yield. */
  servings?: string;
  equipment?: RecipeEquipment[];
  methods?: CookingMethod[];
  cuisine?: string;
  /** Already rendered for the field; blank when the page stated no time. */
  totalMinutes?: string;
  tags?: string[];
  sourceUrl?: string;
};

/**
 * The payload a draft saves as; `servings` and `totalMinutes` are still raw
 * field text.
 */
export type RecipeSubmission = {
  title: string;
  servings: string;
  ingredients: Ingredient[];
  steps: string[];
  equipment: RecipeEquipment[];
  methods: CookingMethod[];
  cuisine: string;
  totalMinutes: string;
  tags: string[];
  sourceUrl: string;
};

/** The row the editor always shows at least one of, so there's a place to type. */
export function emptyIngredient(): Ingredient {
  return { quantity: 1, unit: "", item: "" };
}

export function emptyDraft(): RecipeDraft {
  return {
    title: "",
    servings: "",
    ingredients: [emptyIngredient()],
    steps: [],
    equipment: [],
    methods: [],
    cuisine: "",
    totalMinutes: "",
    tags: [],
    sourceUrl: "",
    url: "",
  };
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
    servings: imported.servings ?? "",
    ingredients: imported.ingredients.length ? imported.ingredients : [emptyIngredient()],
    steps: imported.steps ?? [],
    equipment: imported.equipment ?? [],
    methods: imported.methods ?? [],
    cuisine: imported.cuisine ?? "",
    totalMinutes: imported.totalMinutes ?? "",
    tags: imported.tags ?? [],
    sourceUrl: imported.sourceUrl ?? "",
  };
}

export function withSteps(draft: RecipeDraft, steps: string[]): RecipeDraft {
  return { ...draft, steps };
}

export function withServings(draft: RecipeDraft, servings: string): RecipeDraft {
  return { ...draft, servings };
}

export function withEquipment(draft: RecipeDraft, equipment: RecipeEquipment[]): RecipeDraft {
  return { ...draft, equipment };
}

export function withMethods(draft: RecipeDraft, methods: CookingMethod[]): RecipeDraft {
  return { ...draft, methods };
}

export function withCuisine(draft: RecipeDraft, cuisine: string): RecipeDraft {
  return { ...draft, cuisine };
}

export function withTotalMinutes(draft: RecipeDraft, totalMinutes: string): RecipeDraft {
  return { ...draft, totalMinutes };
}

export function withTags(draft: RecipeDraft, tags: string[]): RecipeDraft {
  return { ...draft, tags };
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

/**
 * Replace the whole ingredient list. The per-index patch and the append helper
 * remain for callers that think in single edits; a client whose editor reports
 * the entire array (see RecipeFields) uses this instead of trying to diff it.
 */
export function withIngredients(draft: RecipeDraft, ingredients: Ingredient[]): RecipeDraft {
  return { ...draft, ingredients };
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
    servings: draft.servings,
    ingredients: draft.ingredients.filter((ing) => ing.item.trim() !== ""),
    steps: draft.steps.map((step) => step.trim()).filter((step) => step !== ""),
    // Tags carry through as-is: unlike blank ingredient rows there is no
    // scaffolding to drop, and an empty list is a meaningful "nothing detected".
    equipment: draft.equipment,
    methods: draft.methods,
    cuisine: draft.cuisine.trim(),
    totalMinutes: draft.totalMinutes,
    tags: draft.tags,
    sourceUrl: draft.sourceUrl.trim(),
  };
}

/** The URL to import, or `null` when there's nothing to import. */
export function draftImportUrl(draft: RecipeDraft): string | null {
  const url = draft.url.trim();
  return url ? url : null;
}
