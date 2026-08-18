import { useHouseholdSizeEditor } from "@pantry/core/data";
import { useId } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * How many people this household cooks for (BL-0018): presentation over
 * `useHouseholdSizeEditor()`.
 *
 * One number, and it earns its place by removing taps rather than adding a
 * screen: the planner seeds each recipe's servings dial from it, so a household
 * of four adding a four-serving recipe never has to touch the stepper at all.
 * Leaving it blank is a real answer — every recipe then starts at one batch,
 * which is exactly the behaviour before this existed.
 */
export function HouseholdSize() {
  const { value, setValue, invalid, loading, pending, error, save } = useHouseholdSizeEditor();
  const fieldId = useId();

  // Rendering the field before the query resolves would show an empty box —
  // indistinguishable from "you have not set this", and one stray keystroke
  // away from overwriting a real answer.
  if (loading) return null;

  return (
    <Card title="Household">
      <p className="text-sm text-muted">
        How many people you usually cook for. New recipes start scaled to this; the planner's
        servings stepper still overrides it per meal.
      </p>
      <div className="mt-2 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-text" htmlFor={fieldId}>
          People
          <Input
            id={fieldId}
            type="number"
            min={1}
            className="w-24"
            value={value}
            placeholder="—"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {invalid && <ErrorText message="Enter a whole number of people, or leave it blank." />}
      <ErrorText message={error} />
    </Card>
  );
}
