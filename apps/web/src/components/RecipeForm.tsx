import { useState } from "react";
import type { Ingredient } from "@pantry/types";
import { createRecipe } from "../lib/recipeService";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createRecipe({
        title: title.trim(),
        ingredients: ingredients.filter((ing) => ing.item.trim() !== ""),
      });
      setTitle("");
      setIngredients([emptyIngredient()]);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel">
      <h2>New recipe</h2>
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
        {busy ? "Saving…" : "Create recipe"}
      </button>
    </form>
  );
}
