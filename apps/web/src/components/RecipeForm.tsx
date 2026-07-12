import type { Ingredient } from "@pantry/types";
import { useState } from "react";
import { createRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const { run, error, pending } = useAsyncAction();

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await run(() =>
      createRecipe({
        title: title.trim(),
        ingredients: ingredients.filter((ing) => ing.item.trim() !== ""),
      }),
    );
    if (created) {
      setTitle("");
      setIngredients([emptyIngredient()]);
      onCreated();
    }
  }

  return (
    <Card title="New recipe">
      <form onSubmit={submit} className="flex flex-col gap-3">
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
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIngredients((p) => [...p, emptyIngredient()])}
          >
            + ingredient
          </Button>
          <Button type="submit" disabled={pending} className="ml-auto">
            {pending ? "Saving…" : "Create recipe"}
          </Button>
        </div>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
