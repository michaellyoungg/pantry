import type { CookingMethod } from "@pantry/types";

/**
 * Display labels for the closed cooking-method enum (BL-0041).
 *
 * The list lives here rather than in `@pantry/types` because that package ships
 * as `dist` only: the Vite dev server the e2e stack runs resolves it without a
 * build step only while every import from it is `import type`. Typing this as a
 * total `Record<CookingMethod, string>` means a method added to the union
 * without a label here fails to compile, so the duplication cannot drift.
 *
 * Declaration order is display order — it mirrors the service's enum order.
 */
export const COOKING_METHOD_LABELS: Record<CookingMethod, string> = {
  bake: "Bake",
  roast: "Roast",
  grill: "Grill",
  smoke: "Smoke",
  sous_vide: "Sous vide",
  slow_cook: "Slow cook",
  pressure_cook: "Pressure cook",
  fry: "Fry",
  saute: "Sauté",
  boil: "Boil",
  marinate: "Marinate",
  no_cook: "No-cook",
};

/** Every method, in display order. Derived so it can never miss a member. */
export const COOKING_METHODS = Object.keys(COOKING_METHOD_LABELS) as CookingMethod[];
