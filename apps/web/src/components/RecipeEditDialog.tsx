import type { Ingredient, Recipe } from "@pantry/types";
import { useEffect, useRef, useState } from "react";
import { cleanIngredients, emptyIngredient, RecipeFields } from "./RecipeFields";
import { Button } from "./ui/Button";

export function RecipeEditDialog({
  recipe,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  onSave: (title: string, ingredients: Ingredient[]) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(recipe.title);
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave(title.trim(), cleanIngredients(ingredients));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Edit recipe</h2>
        <RecipeFields
          title={title}
          ingredients={ingredients}
          onTitleChange={setTitle}
          onIngredientsChange={setIngredients}
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
