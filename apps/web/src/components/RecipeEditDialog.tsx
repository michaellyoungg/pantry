import type { Ingredient, Recipe } from "@pantry/types";
import { useEffect, useRef, useState } from "react";
import { StepsEditor } from "./StepsEditor";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeEditDialog({
  recipe,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  onSave: (title: string, ingredients: Ingredient[], steps: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(recipe.title);
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
  );
  const [steps, setSteps] = useState<string[]>(recipe.steps ?? []);
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
      await onSave(
        title.trim(),
        ingredients.filter((ing) => ing.item.trim() !== ""),
        steps.map((s) => s.trim()).filter((s) => s !== ""),
      );
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
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
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
          onClick={() => setIngredients((p) => [...p, emptyIngredient()])}
          className="self-start"
        >
          + ingredient
        </Button>
        <StepsEditor steps={steps} onChange={setSteps} />
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
