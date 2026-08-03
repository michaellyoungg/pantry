import { api } from "@pantry/convex/api";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * How many people this household cooks for (BL-0018).
 *
 * One number, and it earns its place by removing taps rather than adding a
 * screen: the planner seeds each recipe's servings dial from it, so a household
 * of four adding a four-serving recipe never has to touch the stepper at all.
 * Leaving it blank is a real answer — every recipe then starts at one batch,
 * which is exactly the behaviour before this existed.
 */
export function HouseholdSize() {
  const prefs = useQuery(api.preferences.get);
  const save = useMutation(api.preferences.setHouseholdSize);
  const { run, error, pending } = useAsyncAction();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const fieldId = useId();

  // Rendering the field before the query resolves would show an empty box —
  // indistinguishable from "you have not set this", and one stray keystroke
  // away from overwriting a real answer.
  if (prefs === undefined) return null;

  const value = draft ?? (prefs.householdSize === undefined ? "" : String(prefs.householdSize));

  function submit() {
    const text = value.trim();
    if (text === "") {
      setInvalid(false);
      void run(async () => {
        await save({});
        setDraft(null);
      });
      return;
    }
    const size = Number(text);
    if (!Number.isInteger(size) || size < 1) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void run(async () => {
      await save({ householdSize: size });
      setDraft(null);
    });
  }

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
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {invalid && <ErrorText message="Enter a whole number of people, or leave it blank." />}
      <ErrorText message={error} />
    </Card>
  );
}
