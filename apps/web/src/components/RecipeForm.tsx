import { api } from "@pantry/convex/api";
import type { CookingMethod, Ingredient, Recipe, RecipeEquipment } from "@pantry/types";
import { useState } from "react";
import { formatServings, parseServings } from "../lib/servings";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useEquipmentCatalog } from "../lib/useEquipmentCatalog";
import { useTracedAction } from "../telemetry/useTracedAction";
import { EquipmentEditor } from "./EquipmentEditor";
import { ErrorText } from "./ErrorText";
import { ServingsField } from "./ServingsField";
import { StepsEditor } from "./StepsEditor";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const [steps, setSteps] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<RecipeEquipment[]>([]);
  const [methods, setMethods] = useState<CookingMethod[]>([]);
  const [url, setUrl] = useState("");
  const { catalog } = useEquipmentCatalog();
  const createRecipe = useTracedAction(api.recipes.create, "recipes.create");
  const importFromUrl = useTracedAction(api.recipes.importFromUrl, "recipes.importFromUrl");
  const { run, error, pending } = useAsyncAction();
  const importAction = useAsyncAction();

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function importUrl() {
    if (!url.trim()) return;
    const preview = (await importAction.run(() => importFromUrl({ url: url.trim() }))) as
      | Recipe
      | undefined;
    if (preview) {
      setTitle(preview.title);
      // The import fills this in when the page's recipeYield reads as a serving
      // count; otherwise it stays blank for the user to supply.
      setServings(formatServings(preview.servings));
      setIngredients(preview.ingredients.length ? preview.ingredients : [emptyIngredient()]);
      setSteps(preview.steps ?? []);
      // Import tags equipment and methods deterministically from the steps; the
      // editor below is where a wrong guess gets corrected before saving.
      setEquipment(preview.equipment ?? []);
      setMethods(preview.methods ?? []);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await run(() =>
      createRecipe({
        title: title.trim(),
        servings: parseServings(servings),
        ingredients: ingredients.filter((ing) => ing.item.trim() !== ""),
        steps: steps.map((s) => s.trim()).filter((s) => s !== ""),
        equipment,
        methods,
      }),
    );
    if (created) {
      setTitle("");
      setServings("");
      setIngredients([emptyIngredient()]);
      setSteps([]);
      setEquipment([]);
      setMethods([]);
      setUrl("");
      onCreated();
    }
  }

  return (
    <Card title="New recipe">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Paste a recipe URL to import…"
          className="flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={importUrl} disabled={importAction.pending}>
          {importAction.pending ? "Importing…" : "Import"}
        </Button>
      </div>
      <ErrorText message={importAction.error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <ServingsField value={servings} onChange={setServings} />
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
          className="self-start"
          onClick={() => setIngredients((p) => [...p, emptyIngredient()])}
        >
          + ingredient
        </Button>
        <StepsEditor steps={steps} onChange={setSteps} />
        <EquipmentEditor
          catalog={catalog}
          equipment={equipment}
          methods={methods}
          onEquipmentChange={setEquipment}
          onMethodsChange={setMethods}
        />
        <Button type="submit" disabled={pending} className="self-end">
          {pending ? "Saving…" : "Create recipe"}
        </Button>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
