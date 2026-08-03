import { api } from "@pantry/convex/api";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { addToBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useAsyncData } from "../lib/useAsyncData";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Catalog() {
  const listCatalog = useTracedAction(api.recipes.listCatalog, "recipes.listCatalog");
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
  // Convex actions require an args object; useTracedAction injects traceCtx into it.
  // Wrap in useCallback so useAsyncData's effect (keyed on fn) doesn't refire every render.
  const load = useCallback(() => listCatalog({}), [listCatalog]);
  const { data, loading, error: loadError, reload } = useAsyncData(load);
  const { run, error } = useAsyncAction();
  const recipes = data ?? [];

  return (
    <Card title="Catalog">
      {loading && recipes.length === 0 && <p className="text-sm text-muted">Loading catalog…</p>}
      {loadError && (
        <div className="flex items-center gap-2">
          <ErrorText message={loadError} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && recipes.length === 0 && (
        <p className="text-sm text-muted">No catalog recipes yet.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{r.title}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
              >
                Add to basket
              </Button>
            </div>
            <RecipeDetails recipe={r} />
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
