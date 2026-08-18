import { PREP_WINDOW_LABELS } from "@pantry/core";
import type { PrepTask, PrepTaskInput, PrepWindow } from "@pantry/types";
import { PrepSourceBadge } from "./PrepSourceBadge";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const WINDOWS = Object.keys(PREP_WINDOW_LABELS) as PrepWindow[];

/**
 * Hand-authored prep tasks on the recipe form (BL-0044).
 *
 * Two halves, and the second is the reason this is not just a list of text
 * inputs:
 *
 *  - **Yours** — the tasks you wrote. Text plus a window; no dates, because a
 *    recipe has no cook date until it is planned.
 *  - **Derived** — what the rule table (and, when configured, the importer)
 *    produces for this recipe, each with an *Override* button. Overriding
 *    copies the derived task's key onto a new task of yours, which is what
 *    makes the server replace it rather than show both. Without this affordance
 *    the precedence rule exists but is unreachable: you could add a better
 *    task, and the wrong one would still be sitting next to it.
 *
 * `derived` is optional because a recipe being created has no id yet, so there
 * is nothing to derive against.
 */
export function PrepEditor({
  tasks,
  onChange,
  derived = [],
}: {
  tasks: PrepTaskInput[];
  onChange: (tasks: PrepTaskInput[]) => void;
  /** The current merged tasks for this recipe, if it exists yet. */
  derived?: PrepTask[];
}) {
  function update(i: number, patch: Partial<PrepTaskInput>) {
    onChange(tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function remove(i: number) {
    onChange(tasks.filter((_, idx) => idx !== i));
  }
  function override(task: PrepTask) {
    // The key is the whole mechanism: carrying it over is what turns a new task
    // into a replacement for that one.
    onChange([...tasks, { key: task.key, window: task.window, text: task.text }]);
  }

  // A derived task the user has already overridden is not offered again — it is
  // now sitting in the list above, and showing it twice would suggest the
  // override did not take.
  const overridden = new Set(tasks.map((t) => t.key).filter(Boolean));
  const offered = derived.filter((t) => t.source !== "manual" && !overridden.has(t.key));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text">Prep tasks</span>
      {tasks.length === 0 && (
        <p className="text-sm text-muted">Nothing you've written for this recipe.</p>
      )}
      {tasks.map((task, i) => (
        // Authored tasks have no stable id until the server assigns a key, so an
        // index key is the honest choice for an editable list.
        <div key={i} className="flex items-start gap-2">
          <Input
            placeholder="What has to happen early?"
            className="flex-1"
            value={task.text}
            onChange={(e) => update(i, { text: e.target.value })}
          />
          <select
            aria-label={`When for prep task ${i + 1}`}
            className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            value={task.window}
            onChange={(e) => update(i, { window: e.target.value as PrepWindow })}
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {PREP_WINDOW_LABELS[w]}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove prep task ${i + 1}`}
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
        onClick={() => onChange([...tasks, { text: "", window: "night_before" }])}
      >
        + prep task
      </Button>

      {offered.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-xs text-muted">
            Derived for this recipe — override one to replace it with your own wording.
          </span>
          {offered.map((task) => (
            <div key={task.key} className="flex items-start gap-2 text-sm">
              <span className="flex-1 text-muted">
                {task.text} — {PREP_WINDOW_LABELS[task.window] ?? task.window}
                <PrepSourceBadge source={task.source} />
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Override: ${task.text}`}
                onClick={() => override(task)}
              >
                Override
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
