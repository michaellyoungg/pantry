import { Button } from "./ui/Button";

// StepsEditor edits an ordered list of instruction lines. Steps are free text
// (a sentence or two each), so each row is a textarea rather than an Input.
// Shared by the create form and the edit dialog so both stay in sync.
export function StepsEditor({
  steps,
  onChange,
}: {
  steps: string[];
  onChange: (steps: string[]) => void;
}) {
  function update(i: number, text: string) {
    onChange(steps.map((s, idx) => (idx === i ? text : s)));
  }
  function remove(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text">Steps</span>
      {steps.length === 0 && <p className="text-sm text-muted">No steps yet.</p>}
      {steps.map((step, i) => (
        // Steps have no stable id; index keys are acceptable for an editable list.
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 w-5 shrink-0 text-right text-sm text-muted">{i + 1}.</span>
          <textarea
            className="min-h-[2.5rem] flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            placeholder="Describe this step…"
            value={step}
            onChange={(e) => update(i, e.target.value)}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove step ${i + 1}`}
            onClick={() => remove(i)}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => onChange([...steps, ""])}
      >
        + step
      </Button>
    </div>
  );
}
