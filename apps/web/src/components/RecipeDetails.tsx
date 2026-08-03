import type { EquipmentDef, Ingredient, Recipe } from "@pantry/types";
import { COOKING_METHOD_LABELS } from "../lib/cookingMethods";
import { formatDuration, humanizeSlug } from "../lib/discovery";
import { equipmentName } from "../lib/useEquipmentCatalog";

function ingredientLine(ing: Ingredient): string {
  const qty = Number.isFinite(ing.quantity) && ing.quantity > 0 ? String(ing.quantity) : "";
  const head = [qty, ing.unit, ing.item].filter(Boolean).join(" ");
  return ing.note ? `${head}, ${ing.note}` : head;
}

// RecipeDetails is the read-only view of a saved recipe: its ingredients and,
// when present, its ordered method steps, the hardware it needs and how it is
// cooked. Rendered as a native <details> so the list stays compact until the
// user expands a recipe.
export function RecipeDetails({
  recipe,
  catalog = [],
  open = false,
}: {
  recipe: Recipe;
  /** Equipment catalog, for resolving tag slugs to names. */
  catalog?: EquipmentDef[];
  /**
   * Start expanded. This is how a link into the list (the grocery list's
   * provenance sheet) lands on the recipe it named rather than on a closed row
   * the user then has to find and click.
   */
  open?: boolean;
}) {
  const steps = recipe.steps ?? [];
  const equipment = recipe.equipment ?? [];
  const methods = recipe.methods ?? [];
  const tags = recipe.tags ?? [];
  if (
    recipe.ingredients.length === 0 &&
    steps.length === 0 &&
    equipment.length === 0 &&
    methods.length === 0 &&
    tags.length === 0 &&
    recipe.totalMinutes === undefined &&
    !recipe.cuisine &&
    !recipe.sourceUrl
  ) {
    return null;
  }

  return (
    <details open={open} className="text-sm text-muted">
      <summary className="cursor-pointer select-none hover:text-text">View recipe</summary>
      <div className="mt-2 flex flex-col gap-3 pl-1">
        {(recipe.totalMinutes !== undefined || recipe.cuisine || tags.length > 0) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {recipe.totalMinutes !== undefined && (
              <span>
                <span className="font-medium text-text">Time: </span>
                {formatDuration(recipe.totalMinutes)}
              </span>
            )}
            {recipe.cuisine && (
              <span>
                <span className="font-medium text-text">Cuisine: </span>
                {humanizeSlug(recipe.cuisine)}
              </span>
            )}
            {tags.length > 0 && (
              <span>
                <span className="font-medium text-text">Tags: </span>
                {tags.map(humanizeSlug).join(", ")}
              </span>
            )}
          </p>
        )}
        {methods.length > 0 && (
          <p>
            <span className="font-medium text-text">Method: </span>
            {methods.map((m) => COOKING_METHOD_LABELS[m] ?? m).join(", ")}
          </p>
        )}
        {equipment.length > 0 && (
          <div>
            <p className="font-medium text-text">Equipment</p>
            <ul className="mt-1 list-disc pl-5">
              {equipment.map((e) => (
                <li key={e.id}>
                  {equipmentName(catalog, e.id)}
                  {!e.required && " (optional)"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {recipe.ingredients.length > 0 && (
          <div>
            <p className="font-medium text-text">Ingredients</p>
            <ul className="mt-1 list-disc pl-5">
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>{ingredientLine(ing)}</li>
              ))}
            </ul>
          </div>
        )}
        {steps.length > 0 && (
          <div>
            <p className="font-medium text-text">Steps</p>
            <ol className="mt-1 list-decimal pl-5">
              {steps.map((step, i) => (
                <li key={i} className="whitespace-pre-wrap">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
        {recipe.sourceUrl && (
          <p>
            <span className="font-medium text-text">Source: </span>
            {/* noreferrer as well as noopener: the recipe host has no business
                learning which pantry page linked to it. */}
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-text"
            >
              {sourceLabel(recipe.sourceUrl)}
            </a>
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Show the host, not the full URL: a recipe link is often a paragraph of
 * tracking parameters, and the host is the part that answers "who wrote this?".
 * Falls back to the raw string if it somehow will not parse.
 */
function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
