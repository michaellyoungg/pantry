import { api } from "@pantry/convex/api";
import { PREP_WINDOW_LABELS } from "@pantry/core";
import { useRecipePrep } from "@pantry/core/data";
import { useTracedAction } from "../telemetry/useTracedAction";
import { PrepSourceBadge } from "./PrepSourceBadge";

/**
 * "Before you start" on recipe detail (BL-0042).
 *
 * Shows WINDOWS, not dates, and offers no check-off. A recipe you are reading
 * has no cook date — it may never be scheduled — so "the night before" is the
 * only true statement available, and a tick with no meal to belong to would
 * have nowhere to be stored. Check-off lives on Home, where a task is attached
 * to an actual dinner.
 *
 * Presentation over `useRecipePrep()`, which the native recipe screen renders
 * from too (BL-0061) — so the two clients cannot disagree about what a recipe
 * needs doing to it beforehand.
 */
export function RecipePrep({ recipeId }: { recipeId: string }) {
  const forRecipe = useTracedAction(api.prepTasks.forRecipe, "prepTasks.forRecipe");
  const { tasks, loading } = useRecipePrep(recipeId, { forRecipe });

  if (loading) return <p className="text-xs text-muted">Checking for prep…</p>;
  if (tasks.length === 0) return null;

  return (
    <div>
      <p className="font-medium text-text">Before you start</p>
      <ul className="mt-1 flex flex-col gap-1">
        {tasks.map((task) => (
          <li key={task.key}>
            <span className="text-text">{task.text}</span>{" "}
            <span className="text-muted">— {PREP_WINDOW_LABELS[task.window] ?? task.window}</span>
            {/* Where it came from (BL-0044): a rule's guess and a task the cook
                wrote are trusted differently, and only the labelled one reads
                as something you are invited to override. */}
            <PrepSourceBadge source={task.source} />
          </li>
        ))}
      </ul>
    </div>
  );
}
