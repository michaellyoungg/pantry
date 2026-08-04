import type { CookingMethod, EquipmentDef, Ingredient, RecipeEquipment } from "@pantry/types";
import { useId } from "react";
import { MAX_TOTAL_MINUTES } from "../lib/discovery";
import { EquipmentEditor } from "./EquipmentEditor";
import { ServingsField } from "./ServingsField";
import { StepsEditor } from "./StepsEditor";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/** The row the editor always shows at least one of, so there is a place to type. */
export const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

/** Rows with a blank item are scaffolding, not data — drop them before saving. */
export const cleanIngredients = (ingredients: Ingredient[]): Ingredient[] =>
  ingredients.filter((ing) => ing.item.trim() !== "");

/**
 * Everything a recipe editor edits. `servings`, `totalMinutes` and `tags` are
 * the raw field text, not the wire values: parsing belongs to the caller that
 * submits, so this component never has to know the API's shape.
 */
export interface RecipeFieldsValue {
  title: string;
  servings: string;
  ingredients: Ingredient[];
  steps: string[];
  equipment: RecipeEquipment[];
  methods: CookingMethod[];
  cuisine: string;
  totalMinutes: string;
  tags: string;
}

/**
 * The shared review-and-edit surface (BL-0020).
 *
 * Every path that produces a recipe — manual entry, URL-import review, and the
 * edit dialog — renders THIS component, because the UX plan's rule is that "the
 * import review screen and the edit dialog should be one component". Before
 * this, a parsed recipe and a hand-typed one were reviewed through two separate
 * editors that drifted apart field by field: the surest way to ship an import
 * that silently drops whatever the edit dialog forgot to render.
 *
 * Fully controlled — the caller owns the state, so an importer can pre-fill it
 * and a dialog can seed it from a saved recipe.
 */
export function RecipeFields({
  value,
  onChange,
  catalog,
}: {
  value: RecipeFieldsValue;
  /** Receives only the changed keys; the caller merges. */
  onChange: (patch: Partial<RecipeFieldsValue>) => void;
  /** Equipment catalog, for the equipment picker. */
  catalog: EquipmentDef[];
}) {
  // Create and edit are both mounted on /recipes at once, so every label's
  // target has to be unique per instance.
  const id = useId();

  function updateIngredient(index: number, patch: Partial<Ingredient>) {
    onChange({
      ingredients: value.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    });
  }

  return (
    <>
      <Input
        placeholder="Title"
        value={value.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <ServingsField value={value.servings} onChange={(servings) => onChange({ servings })} />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-time`} className="text-sm text-muted">
          Cook time
        </label>
        <Input
          id={`${id}-time`}
          type="number"
          min={1}
          max={MAX_TOTAL_MINUTES}
          className="w-24"
          placeholder="—"
          value={value.totalMinutes}
          onChange={(e) => onChange({ totalMinutes: e.target.value })}
        />
        <span className="text-xs text-muted">minutes, total — blank if unknown</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-cuisine`} className="text-sm text-muted">
          Cuisine
        </label>
        <Input
          id={`${id}-cuisine`}
          className="w-40"
          placeholder="e.g. Italian"
          value={value.cuisine}
          onChange={(e) => onChange({ cuisine: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-tags`} className="text-sm text-muted">
          Tags
        </label>
        <Input
          id={`${id}-tags`}
          className="min-w-40 flex-1"
          placeholder="vegan, weeknight"
          value={value.tags}
          onChange={(e) => onChange({ tags: e.target.value })}
        />
        <span className="text-xs text-muted">comma separated</span>
      </div>

      <div className="flex flex-col gap-2">
        {/* Index keys: rows carry no stable id and are only ever appended to or
            edited in place, never reordered — the same trade-off the editors
            this component replaces already made. */}
        {value.ingredients.map((ing, i) => (
          <div key={i} className="flex gap-2">
            <Input
              type="number"
              className="w-16"
              aria-label="quantity"
              value={ing.quantity}
              onChange={(e) => updateIngredient(i, { quantity: Number(e.target.value) })}
            />
            <Input
              placeholder="unit"
              className="w-24"
              value={ing.unit}
              onChange={(e) => updateIngredient(i, { unit: e.target.value })}
            />
            <Input
              placeholder="item"
              className="flex-1"
              value={ing.item}
              onChange={(e) => updateIngredient(i, { item: e.target.value })}
            />
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => onChange({ ingredients: [...value.ingredients, emptyIngredient()] })}
      >
        + ingredient
      </Button>

      <StepsEditor steps={value.steps} onChange={(steps) => onChange({ steps })} />
      <EquipmentEditor
        catalog={catalog}
        equipment={value.equipment}
        methods={value.methods}
        onEquipmentChange={(equipment) => onChange({ equipment })}
        onMethodsChange={(methods) => onChange({ methods })}
      />
    </>
  );
}
