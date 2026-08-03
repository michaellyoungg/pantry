import type { Ingredient, Recipe } from "@pantry/types";

function ingredientLine(ing: Ingredient): string {
  const qty = Number.isFinite(ing.quantity) && ing.quantity > 0 ? String(ing.quantity) : "";
  const head = [qty, ing.unit, ing.item].filter(Boolean).join(" ");
  return ing.note ? `${head}, ${ing.note}` : head;
}

// RecipeDetails is the read-only view of a saved recipe: its ingredients and,
// when present, its ordered method steps. Rendered as a native <details> so the
// list stays compact until the user expands a recipe.
export function RecipeDetails({ recipe }: { recipe: Recipe }) {
  const steps = recipe.steps ?? [];
  if (recipe.ingredients.length === 0 && steps.length === 0) return null;

  return (
    <details className="text-sm text-muted">
      <summary className="cursor-pointer select-none hover:text-text">View recipe</summary>
      <div className="mt-2 flex flex-col gap-3 pl-1">
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
      </div>
    </details>
  );
}
