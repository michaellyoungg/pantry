import { MAX_SERVINGS } from "@pantry/core";
import { useId } from "react";
import { Input } from "./ui/Input";

/**
 * The recipe yield field, shared by the create form and the edit dialog. Blank
 * means "unknown" rather than zero, so it is never pre-filled with a guess.
 */
export function ServingsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // The create form and the edit dialog are both mounted on /recipes, so the
  // label's target has to be unique per instance.
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">
        Servings
      </label>
      <Input
        id={id}
        type="number"
        min={1}
        max={MAX_SERVINGS}
        className="w-20"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-muted">optional — leave blank if unknown</span>
    </div>
  );
}
