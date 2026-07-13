import type { Ingredient } from "@pantry/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

export const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

// Rows with a blank item are scaffolding, not data — drop them before saving.
export const cleanIngredients = (ingredients: Ingredient[]): Ingredient[] =>
  ingredients.filter((ing) => ing.item.trim() !== "");

// The shared review-and-edit surface: one editable title + ingredient rows,
// used by every "add a recipe" path (manual entry, URL-import review, and the
// edit dialog) so a parsed recipe and a hand-typed one are reviewed the same
// way. Fully controlled — callers own the draft state so an importer can
// pre-fill it and a dialog can seed it from an existing recipe.
export function RecipeFields({
  title,
  ingredients,
  onTitleChange,
  onIngredientsChange,
}: {
  title: string;
  ingredients: Ingredient[];
  onTitleChange: (title: string) => void;
  onIngredientsChange: (ingredients: Ingredient[]) => void;
}) {
  function update(i: number, patch: Partial<Ingredient>) {
    onIngredientsChange(ingredients.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  return (
    <>
      <Input placeholder="Title" value={title} onChange={(e) => onTitleChange(e.target.value)} />
      <div className="flex flex-col gap-2">
        {ingredients.map((ing, i) => (
          <div key={i} className="flex gap-2">
            <Input
              type="number"
              className="w-16"
              value={ing.quantity}
              onChange={(e) => update(i, { quantity: Number(e.target.value) })}
            />
            <Input
              placeholder="unit"
              className="w-24"
              value={ing.unit}
              onChange={(e) => update(i, { unit: e.target.value })}
            />
            <Input
              placeholder="item"
              className="flex-1"
              value={ing.item}
              onChange={(e) => update(i, { item: e.target.value })}
            />
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mr-auto"
        onClick={() => onIngredientsChange([...ingredients, emptyIngredient()])}
      >
        + ingredient
      </Button>
    </>
  );
}
