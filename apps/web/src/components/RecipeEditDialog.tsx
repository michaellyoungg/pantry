import { useEffect, useRef, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

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

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave(title.trim(), ingredients.filter((ing) => ing.item.trim() !== ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onCancel={onClose} onClose={onClose}>
      <form onSubmit={submit}>
        <h2>Edit recipe</h2>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        {ingredients.map((ing, i) => (
          <div key={i} className="ingredient-row">
            <input
              type="number"
              value={ing.quantity}
              onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              style={{ width: "4rem" }}
            />
            <input placeholder="unit" value={ing.unit} onChange={(e) => update(i, { unit: e.target.value })} />
            <input placeholder="item" value={ing.item} onChange={(e) => update(i, { item: e.target.value })} />
          </div>
        ))}
        <button type="button" onClick={() => setIngredients((p) => [...p, emptyIngredient()])}>
          + ingredient
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
