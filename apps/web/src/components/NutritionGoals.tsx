import { api } from "@pantry/convex/api";
import { DIET_PRESETS, NUTRIENT_CATALOG, nutrientMeta } from "@pantry/core";
import { useAsyncAction } from "@pantry/core/react";
import type { NutritionTarget, NutritionTargetPeriod } from "@pantry/types";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { goalLabel } from "../lib/nutritionGoals";
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
 */

const PERIODS: ReadonlyArray<{ value: NutritionTargetPeriod; label: string; heading: string }> = [
  { value: "day", label: "day", heading: "Per day" },
  { value: "week", label: "week", heading: "Per week" },
  { value: "meal", label: "meal", heading: "Per meal" },
];

const OPERATORS: ReadonlyArray<{ value: NutritionTarget["operator"]; label: string }> = [
  { value: ">=", label: "at least" },
  { value: "<=", label: "at most" },
  { value: "==", label: "about" },
];

const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function NutritionGoals() {
  // Deliberately uncast: `useQuery` infers the row type, which keeps `_id` a
  // branded Id<"nutritionTargets"> so the mutations below cannot be handed a
  // bare string. The rows satisfy NutritionTarget structurally.
  const rows = useQuery(api.nutritionTargets.list) ?? [];
  const add = useMutation(api.nutritionTargets.add);
  const remove = useMutation(api.nutritionTargets.remove);
  const setActive = useMutation(api.nutritionTargets.setActive);
  const applyPreset = useMutation(api.nutritionTargets.applyPreset);
  const { run, error, pending } = useAsyncAction();

  const [nutrientId, setNutrientId] = useState(NUTRIENT_CATALOG[0].id);
  const [operator, setOperator] = useState<NutritionTarget["operator"]>(">=");
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<NutritionTargetPeriod>("day");

  function submit() {
    const amount = Number(value);
    // A goal with no number is not a goal. Bail rather than storing NaN, which
    // the evaluator would have to reject anyway — one round trip later.
    if (value.trim() === "" || !Number.isFinite(amount) || amount < 0) return;
    void run(async () => {
      await add({ nutrientId, operator, value: amount, period });
      setValue("");
    });
  }

  const unit = nutrientMeta(nutrientId)?.unit ?? "";

  return (
    <div className="flex flex-col gap-4">
      <Card title="Your goals">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            No goals yet. Set one below, or start from a diet on the right.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {PERIODS.filter((p) => rows.some((r) => r.period === p.value)).map((p) => (
              <div key={p.value} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {p.heading}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {rows
                    .filter((r) => r.period === p.value)
                    .map((row) => (
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
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void run(() => setActive({ id: row._id, active: !row.active }))
                            }
                          >
                            {row.active ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void run(() => remove({ id: row._id }))}
                          >
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
              value={nutrientId}
              onChange={(e) => setNutrientId(e.target.value)}
            >
              {NUTRIENT_CATALOG.map((n) => (
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
              value={operator}
              onChange={(e) => setOperator(e.target.value as NutritionTarget["operator"])}
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-amount">Amount{unit && ` (${unit})`}</label>
            <Input
              id="goal-amount"
              type="number"
              min="0"
              step="any"
              className="w-28"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <label htmlFor="goal-period">Per</label>
            <select
              id="goal-period"
              className={selectClass}
              value={period}
              onChange={(e) => setPeriod(e.target.value as NutritionTargetPeriod)}
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={submit} disabled={pending}>
            Add goal
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Setting the same nutrient for the same window again re-tunes that goal rather than adding
          a second, contradictory one.
        </p>
      </Card>

      <Card title="Start from a diet">
        {/* Presets are data (`@pantry/core/dietPresets.json`), and applying one
            just writes ordinary target rows. Nothing downstream — the schema,
            the evaluator, this component — knows a diet exists, which is why a
            new one costs an entry in a JSON file and nothing else. */}
        <ul className="flex flex-col gap-2">
          {DIET_PRESETS.map((preset) => (
            <li key={preset.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{preset.label}</span>
                <span className="block text-xs text-muted">{preset.description}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => void run(() => applyPreset({ targets: preset.targets }))}
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
