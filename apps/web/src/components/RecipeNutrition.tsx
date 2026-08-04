import { api } from "@pantry/convex/api";
import { nutritionFactsLabel } from "@pantry/core";
import { useAsyncData } from "@pantry/core/react";
import { useQuery } from "convex/react";
import { useCallback } from "react";
import { nutritionDisplay } from "../lib/nutrition";
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
 */
export function RecipeNutrition({ recipeId }: { recipeId: string }) {
  const getNutrition = useTracedAction(api.recipes.nutrition, "recipes.nutrition");
  const load = useCallback(() => getNutrition({ id: recipeId }), [getNutrition, recipeId]);
  const { data, loading, error, reload } = useAsyncData(load, [recipeId]);
  const targets = useQuery(api.nutritionTargets.list) ?? [];

  if (loading && !data) {
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
  if (!data) return null;

  const display = nutritionDisplay(data);

  if (display.kind === "empty") {
    return <p className="py-2 text-sm text-muted">Add ingredients to see an estimate.</p>;
  }

  if (display.kind === "unavailable") {
    return (
      <div className="py-2 text-sm text-muted">
        <p>
          Not enough of this recipe could be identified to estimate its nutrition (about{" "}
          {display.coveragePercent}% accounted for).
        </p>
        {display.missing.length > 0 && <MissingNote items={display.missing} />}
        {/* Goals still get an answer here — "can't tell" — because the case a
            user most needs told about is the one where we could not measure. */}
        <RecipeGoalFit estimate={data} />
      </div>
    );
  }

  // Per serving is the number a cook actually wants, so it leads when the recipe
  // has a yield. Without one (BL-0035 leaves servings optional) the whole-recipe
  // total is the only honest figure and stands alone.
  //
  // The server's own `perServing` is used rather than dividing `nutrients` here.
  // It is absent exactly when the yield is unknown, so consuming it is what
  // makes "never divide by a guess" structural instead of a rule this component
  // has to remember.
  const perServing = display.servings > 0 ? data.perServing : undefined;

  const rows = nutritionFactsLabel(perServing ?? data.nutrients, {
    targets,
    // A `meal` target is written against one serving. Scoring it against a whole
    // recipe would report a four-serving casserole as four times over the goal,
    // so a recipe with no yield gets the panel with no personal column at all.
    period: perServing ? "meal" : undefined,
  });

  return (
    <div className="py-2">
      {/* The verdict leads: a cook scanning the list wants "does this fit?"
          before they want fifteen numbers. */}
      <RecipeGoalFit estimate={data} />
      <NutritionFactsPanel
        className="mt-2"
        rows={rows}
        servingsLabel={perServing ? servingsLabel(display.servings) : "Entire recipe"}
        coveragePercent={display.coveragePercent}
      />
      {display.missing.length > 0 && (
        <div className="mt-2 text-sm text-muted">
          <MissingNote items={display.missing} />
        </div>
      )}
    </div>
  );
}

/** "4 servings per recipe" — a count, which is all we know. */
function servingsLabel(servings: number): string {
  return `${servings} ${servings === 1 ? "serving" : "servings"} per recipe`;
}

function MissingNote({ items }: { items: string[] }) {
  return (
    <p>
      Not counted: <span className="text-text">{items.join(", ")}</span>
    </p>
  );
}
