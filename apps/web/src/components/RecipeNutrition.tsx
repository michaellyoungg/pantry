import { api } from "@pantry/convex/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import { nutritionDisplay } from "../lib/nutrition";
import { useAsyncData } from "../lib/useAsyncData";
import { ErrorText } from "./ErrorText";
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
  const getNutrition = useAction(api.recipes.nutrition);
  const load = useCallback(() => getNutrition({ id: recipeId }), [getNutrition, recipeId]);
  const { data, loading, error, reload } = useAsyncData(load, [recipeId]);

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
      </div>
    );
  }

  return (
    <div className="py-2">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted">
        Estimated · whole recipe
        {display.coveragePercent < 100 &&
          ` · ${display.coveragePercent}% of ingredients accounted for`}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {display.rows.map((row) => (
          <div key={row.id} className="flex flex-col">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="text-sm font-medium text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
      {display.missing.length > 0 && (
        <div className="mt-2 text-sm text-muted">
          <MissingNote items={display.missing} />
        </div>
      )}
      {/*
        Per-serving figures need a yield on the recipe, which arrives with
        BL-0035. Until then the honest thing is whole-recipe totals — dividing by
        a guessed serving count would be confidently wrong.
      */}
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
