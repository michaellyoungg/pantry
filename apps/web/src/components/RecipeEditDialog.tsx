import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import type {
  CookingMethod,
  EquipmentDef,
  Ingredient,
  PrepTaskInput,
  Recipe,
  RecipeEquipment,
} from "@pantry/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toISODate } from "../lib/prep";
import { formatServings, parseServings } from "../lib/servings";
import { useTracedAction } from "../telemetry/useTracedAction";
import { EquipmentEditor } from "./EquipmentEditor";
import { PrepEditor } from "./PrepEditor";
import { ServingsField } from "./ServingsField";
import { StepsEditor } from "./StepsEditor";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeEditDialog({
  recipe,
  catalog,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  catalog: EquipmentDef[];
  onSave: (
    title: string,
    servings: number | undefined,
    ingredients: Ingredient[],
    steps: string[],
    equipment: RecipeEquipment[],
    methods: CookingMethod[],
    prepTasks: PrepTaskInput[],
  ) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(recipe.title);
  // Seeded from the stored yield so saving an unrelated edit does not clear it —
  // update replaces the whole recipe.
  const [servings, setServings] = useState(formatServings(recipe.servings));
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
  );
  const [steps, setSteps] = useState<string[]>(recipe.steps ?? []);
  const [equipment, setEquipment] = useState<RecipeEquipment[]>(recipe.equipment ?? []);
  const [methods, setMethods] = useState<CookingMethod[]>(recipe.methods ?? []);
  // Only the user's own tasks are editable here. Model-derived ones are stored
  // too but are not this form's to rewrite — they are offered for override
  // below, like rule-derived ones, which is what keeps provenance honest.
  const [prepTasks, setPrepTasks] = useState<PrepTaskInput[]>(() =>
    (recipe.prepTasks ?? [])
      .filter((task) => task.source === "manual")
      .map((task) => ({ key: task.key, window: task.window, text: task.text })),
  );
  const [busy, setBusy] = useState(false);

  // What this recipe currently derives, so a rule the user disagrees with can
  // be overridden rather than merely worked around. A recipe being edited has
  // no cook date, so today stands in and the dates are never shown.
  const forRecipe = useTracedAction(api.prepTasks.forRecipe, "prepTasks.forRecipe");
  const cookDate = toISODate(new Date());
  const loadPrep = useCallback(
    () => forRecipe({ recipeId: recipe.id, cookDate }),
    [forRecipe, recipe.id, cookDate],
  );
  const { data: derivedPrep } = useAsyncData(loadPrep);

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
        parseServings(servings),
        ingredients.filter((ing) => ing.item.trim() !== ""),
        steps.map((s) => s.trim()).filter((s) => s !== ""),
        equipment,
        methods,
        prepTasks,
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
          onClick={() => setIngredients((p) => [...p, emptyIngredient()])}
          className="self-start"
        >
          + ingredient
        </Button>
        <StepsEditor steps={steps} onChange={setSteps} />
        <PrepEditor tasks={prepTasks} onChange={setPrepTasks} derived={derivedPrep?.tasks ?? []} />
        <EquipmentEditor
          catalog={catalog}
          equipment={equipment}
          methods={methods}
          onEquipmentChange={setEquipment}
          onMethodsChange={setMethods}
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
