import { GOAL_OPERATORS, GOAL_PERIODS, goalLabel, HEADLINE_NUTRIENTS } from "@pantry/core";
import { useNutritionGoals } from "@pantry/core/data";
import type { NutritionTarget, NutritionTargetPeriod } from "@pantry/types";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * The goal editor (BL-0038).
 *
 * Every control here edits the *same* row shape — `{nutrientId, operator, value,
 * period}` — because that is the only shape the system has. There is no
 * "low-carb mode" toggle to keep in sync with a threshold constant, and adding
 * cholesterol to the list of things you can constrain took no code at all: the
 * nutrient dropdown is the shared catalog, and the diet buttons are the shared
 * preset data.
 *
 * Presentation over `useNutritionGoals()` since BL-0065 gave the native client
 * the same editor — including what counts as a usable amount, which is a rule
 * and not a form detail.
 */

const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function NutritionGoals() {
  const {
    groups,
    loading,
    presets,
    draft,
    patchDraft,
    draftUnit,
    canAdd,
    addGoal,
    removeGoal,
    togglePaused,
    toggleHard,
    applyPreset,
    pending,
    error,
  } = useNutritionGoals();

  return (
    <div className="flex flex-col gap-4">
      <Card title="Your goals">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">
            {loading
              ? "Loading your goals…"
              : "No goals yet. Set one below, or start from a diet on the right."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.period} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.heading}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {group.rows.map((row) => (
                    <li key={row._id} className="flex items-center justify-between gap-2 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`truncate text-sm ${row.active ? "text-text" : "text-muted line-through"}`}
                        >
                          {goalLabel(row)}
                        </span>
                        {/* A paused goal stays visible: hiding it would make
                            the screen look like the goal was deleted, and the
                            tuned number would be silently unrecoverable. */}
                        {!row.active && (
                          <span className="shrink-0 rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                            Paused
                          </span>
                        )}
                        {/* A required goal does something categorically
                            different from a preferred one — it removes
                            recipes. That has to be visible on the row, not
                            buried in the button that set it. */}
                        {row.hard && row.active && (
                          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">
                            Required
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-pressed={row.hard === true}
                          title="Required goals remove recipes that break them from your suggestions"
                          onClick={() => toggleHard(row)}
                        >
                          {row.hard ? "Preferred" : "Require"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => togglePaused(row)}>
                          {row.active ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => removeGoal(row)}>
                          Remove
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add a goal">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-nutrient">Nutrient</label>
            <select
              id="goal-nutrient"
              className={selectClass}
              value={draft.nutrientId}
              onChange={(e) => patchDraft({ nutrientId: e.target.value })}
            >
              {HEADLINE_NUTRIENTS.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-rule">Rule</label>
            <select
              id="goal-rule"
              className={selectClass}
              value={draft.operator}
              onChange={(e) =>
                patchDraft({ operator: e.target.value as NutritionTarget["operator"] })
              }
            >
              {GOAL_OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-amount">Amount{draftUnit && ` (${draftUnit})`}</label>
            <Input
              id="goal-amount"
              type="number"
              min="0"
              step="any"
              className="w-28"
              value={draft.value}
              onChange={(e) => patchDraft({ value: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-period">Per</label>
            <select
              id="goal-period"
              className={selectClass}
              value={draft.period}
              onChange={(e) => patchDraft({ period: e.target.value as NutritionTargetPeriod })}
            >
              {GOAL_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={addGoal} disabled={pending || !canAdd}>
            Add goal
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Setting the same nutrient for the same window again re-tunes that goal rather than adding
          a second, contradictory one.
        </p>
        <p className="mt-1 text-xs text-muted">
          Every goal starts as a preference: it moves suggestions up and down. Make one{" "}
          <strong className="font-medium text-text">required</strong> and recipes that break it stop
          being suggested at all. The rule you wrote does not decide that — you do.
        </p>
      </Card>

      <Card title="Start from a diet">
        {/* Presets are data (`@pantry/core/dietPresets.json`), and applying one
            just writes ordinary target rows. Nothing downstream — the schema,
            the evaluator, this component — knows a diet exists, which is why a
            new one costs an entry in a JSON file and nothing else. */}
        <ul className="flex flex-col gap-2">
          {presets.map((preset) => (
            <li key={preset.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{preset.label}</span>
                <span className="block text-xs text-muted">{preset.description}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => applyPreset(preset)}
              >
                Use {preset.label}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <ErrorText message={error} />
    </div>
  );
}
