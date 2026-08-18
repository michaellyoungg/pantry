import { COOKING_METHOD_LABELS, formatDuration, humanizeSlug } from "@pantry/core";
import type { EquipmentDef, Ingredient, Recipe } from "@pantry/types";
import { useEffect, useState } from "react";
import { equipmentName } from "../lib/useEquipmentCatalog";
import { RecipePrep } from "./RecipePrep";

function ingredientLine(ing: Ingredient): string {
  const qty = Number.isFinite(ing.quantity) && ing.quantity > 0 ? String(ing.quantity) : "";
  const head = [qty, ing.unit, ing.item].filter(Boolean).join(" ");
  return ing.note ? `${head}, ${ing.note}` : head;
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

// RecipeDetails is the read-only view of a saved recipe: its ingredients and,
// when present, its ordered method steps, the hardware it needs and how it is
// cooked. Rendered as a native <details> so the list stays compact until the
// user expands a recipe.
export function RecipeDetails({
  recipe,
  catalog = [],
  // Aliased so the prop stays `open` for callers while the live expansion
  // state below can own that name internally.
  open: defaultOpen = false,
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
  // Whether the row is actually expanded right now, seeded from defaultOpen.
  // Tracked in state — not just handed to <details open> — because prep
  // derivation is a network round trip per recipe and is deferred until the row
  // is open. A native <details> keeps its children mounted while collapsed,
  // which would otherwise fire one request for every recipe in the list on
  // first render.
  const [open, setOpen] = useState(defaultOpen);
  // The prop can flip on an ALREADY MOUNTED row: opening the provenance sheet
  // for a second recipe re-points `openRecipeId` without remounting the list, so
  // seeding state once would leave that row stubbornly closed (BL-0019).
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
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
    <details
      open={open}
      className="text-sm text-muted"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none hover:text-text">View recipe</summary>
      <div className="mt-2 flex flex-col gap-3 pl-1">
        {/* Discovery metadata (BL-0020) reads as a header strip: it is what the
            catalog's chips filter on, so it belongs where the eye lands first. */}
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
        {/* Lead-time prep (BL-0042), derived from the tags and ingredients
            below rather than authored on the recipe. */}
        {open && <RecipePrep recipeId={recipe.id} />}
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
