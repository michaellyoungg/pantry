import { api } from "@pantry/convex/api";
import { useRecipeNutrition } from "@pantry/core/data";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { NutritionFactsPanel } from "./NutritionFactsPanel";
import { RecipeGoalFit } from "./RecipeGoalFit";
import { Button } from "./ui/Button";

/**
 * Estimated nutrition for one recipe.
 *
 * Every figure here is labelled *estimated* and every panel states its coverage.
 * We estimate the sum of as-purchased ingredients — water loss, drained fat, and
 * "salt to taste" are not modelled — so a confident-looking number would be
 * dishonest. Below the coverage threshold the numbers are suppressed entirely
 * and the missing ingredients are named instead.
 *
 * Presentation over `useRecipeNutrition()`: which of the three shapes to draw,
 * whether the figures are per serving, and how the recipe sits against the
 * user's goals are all decided in `@pantry/core` (BL-0065), so the native
 * screen cannot reach a different answer about the same recipe.
 */
export function RecipeNutrition({ recipeId }: { recipeId: string }) {
  const getNutrition = useTracedAction(api.recipes.nutrition, "recipes.nutrition");
  const { view, loading, error, reload } = useRecipeNutrition(recipeId, { getNutrition });

  if (loading && !view) {
    return <p className="py-2 text-sm text-muted">Estimating nutrition…</p>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 py-2">
        <ErrorText message={error} />
        <Button variant="secondary" size="sm" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }
  if (!view) return null;

  if (view.kind === "empty") {
    return <p className="py-2 text-sm text-muted">Add ingredients to see an estimate.</p>;
  }

  if (view.kind === "unavailable") {
    return (
      <div className="py-2 text-sm text-muted">
        <p>
          Not enough of this recipe could be identified to estimate its nutrition (about{" "}
          {view.coveragePercent}% accounted for).
        </p>
        {view.missing.length > 0 && <MissingNote items={view.missing} />}
        {/* Goals still get an answer here — "can't tell" — because the case a
            user most needs told about is the one where we could not measure. */}
        <RecipeGoalFit fit={view.goalFit} />
      </div>
    );
  }

  return (
    <div className="py-2">
      {/* The verdict leads: a cook scanning the list wants "does this fit?"
          before they want fifteen numbers. */}
      <RecipeGoalFit fit={view.goalFit} />
      <NutritionFactsPanel
        className="mt-2"
        rows={view.rows}
        servingsLabel={view.servingsLabel}
        coveragePercent={view.coveragePercent}
      />
      {view.missing.length > 0 && (
        <div className="mt-2 text-sm text-muted">
          <MissingNote items={view.missing} />
        </div>
      )}
    </div>
  );
}

function MissingNote({ items }: { items: string[] }) {
  return (
    <p>
      Not counted: <span className="text-text">{items.join(", ")}</span>
    </p>
  );
}
