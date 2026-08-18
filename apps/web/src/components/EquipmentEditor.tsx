import { COOKING_METHOD_LABELS, COOKING_METHODS, equipmentName } from "@pantry/core";
import type {
  CookingMethod,
  EquipmentCategory,
  EquipmentDef,
  RecipeEquipment,
} from "@pantry/types";
import { Button } from "./ui/Button";

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  appliance: "Appliances",
  cookware: "Cookware",
  tool: "Tools",
};

const CATEGORY_ORDER: EquipmentCategory[] = ["appliance", "cookware", "tool"];

/**
 * Edits a recipe's equipment tags and cooking methods. Import guesses at both
 * (deterministically, from the steps), so the job here is correcting a guess:
 * drop a tag, demote it to optional, or add one the scan missed.
 *
 * The catalog can be 50+ entries, so equipment is added through a picker rather
 * than a wall of checkboxes; methods are a closed 12-member enum and fit as
 * toggles. Shared by the create form and the edit dialog.
 */
export function EquipmentEditor({
  catalog,
  equipment,
  methods,
  onEquipmentChange,
  onMethodsChange,
}: {
  catalog: EquipmentDef[];
  equipment: RecipeEquipment[];
  methods: CookingMethod[];
  onEquipmentChange: (equipment: RecipeEquipment[]) => void;
  onMethodsChange: (methods: CookingMethod[]) => void;
}) {
  const selected = new Set(equipment.map((e) => e.id));
  const available = catalog.filter((e) => !selected.has(e.id));

  function add(id: string) {
    if (!id || selected.has(id)) return;
    onEquipmentChange([...equipment, { id, required: true }]);
  }
  function toggleRequired(id: string) {
    onEquipmentChange(equipment.map((e) => (e.id === id ? { ...e, required: !e.required } : e)));
  }
  function remove(id: string) {
    onEquipmentChange(equipment.filter((e) => e.id !== id));
  }
  function toggleMethod(method: CookingMethod) {
    onMethodsChange(
      methods.includes(method) ? methods.filter((m) => m !== method) : [...methods, method],
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text">Equipment</span>
        {equipment.length === 0 && <p className="text-sm text-muted">No equipment yet.</p>}
        {equipment.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            <span className="flex-1 text-sm text-text">{equipmentName(catalog, e.id)}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Mark ${equipmentName(catalog, e.id)} as ${e.required ? "optional" : "required"}`}
              onClick={() => toggleRequired(e.id)}
            >
              {e.required ? "Required" : "Optional"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${equipmentName(catalog, e.id)}`}
              onClick={() => remove(e.id)}
            >
              ✕
            </Button>
          </div>
        ))}
        <select
          aria-label="Add equipment"
          className="self-start rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          value=""
          disabled={available.length === 0}
          onChange={(event) => add(event.target.value)}
        >
          <option value="">+ add equipment…</option>
          {CATEGORY_ORDER.map((category) => {
            const entries = available.filter((e) => e.category === category);
            if (entries.length === 0) return null;
            return (
              <optgroup key={category} label={CATEGORY_LABELS[category]}>
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">Cooking methods</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {COOKING_METHODS.map((method) => (
            <label key={method} className="flex items-center gap-1.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={methods.includes(method)}
                onChange={() => toggleMethod(method)}
              />
              {COOKING_METHOD_LABELS[method]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
