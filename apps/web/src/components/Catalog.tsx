import { api } from "@pantry/convex/api";
import { useAction, useMutation } from "convex/react";
import { addToBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useAsyncData } from "../lib/useAsyncData";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Catalog() {
  const listCatalog = useAction(api.recipes.listCatalog);
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
  const { data, loading, error: loadError, reload } = useAsyncData(listCatalog);
  const { run, error } = useAsyncAction();
  const recipes = data ?? [];

  return (
    <Card title="Catalog">
      {loading && <p className="text-sm text-muted">Loading catalog…</p>}
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
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
            >
              Add to basket
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
