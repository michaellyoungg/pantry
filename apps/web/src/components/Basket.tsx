import { api } from "@pantry/convex/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Basket() {
  const items = useQuery(api.basket.list) ?? [];
  const remove = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const rm = useAsyncAction();

  return (
    <Card title="Basket">
      {items.length === 0 && <p className="text-sm text-muted">Basket is empty.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((b) => (
          <li key={b._id} className="flex items-center justify-between gap-2 py-2">
            <span className="text-text">{b.title}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                gen.clearError();
                rm.run(() => remove({ recipeId: b.recipeId }));
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="mt-3"
        onClick={() => {
          rm.clearError();
          gen.run(() => generate({}));
        }}
        disabled={gen.pending || items.length === 0}
      >
        {gen.pending ? "Generating…" : "Generate grocery list"}
      </Button>
      <ErrorText message={gen.error ?? rm.error} />
    </Card>
  );
}
