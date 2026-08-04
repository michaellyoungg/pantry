import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import { useCallback } from "react";
import { PREP_WINDOW_LABELS, toISODate } from "../lib/prep";
import { useTracedAction } from "../telemetry/useTracedAction";

/**
 * "Before you start" on recipe detail (BL-0042).
 *
 * Shows WINDOWS, not dates, and offers no check-off. A recipe you are reading
 * has no cook date — it may never be scheduled — so "the night before" is the
 * only true statement available, and a tick with no meal to belong to would
 * have nowhere to be stored. Check-off lives on Home, where a task is attached
 * to an actual dinner.
 *
 * The derivation still needs *a* date to resolve windows against, so today is
 * passed and the resulting dates are deliberately not rendered.
 */
export function RecipePrep({ recipeId }: { recipeId: string }) {
  const forRecipe = useTracedAction(api.prepTasks.forRecipe, "prepTasks.forRecipe");
  const cookDate = toISODate(new Date());
  const load = useCallback(
    () => forRecipe({ recipeId, cookDate }),
    [forRecipe, recipeId, cookDate],
  );
  const { data, loading } = useAsyncData(load);

  if (loading) return <p className="text-xs text-muted">Checking for prep…</p>;
  const tasks = data?.tasks ?? [];
  if (tasks.length === 0) return null;

  return (
    <div>
      <p className="font-medium text-text">Before you start</p>
      <ul className="mt-1 flex flex-col gap-1">
        {tasks.map((task) => (
          <li key={task.key}>
            <span className="text-text">{task.text}</span>{" "}
            <span className="text-muted">— {PREP_WINDOW_LABELS[task.window] ?? task.window}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
