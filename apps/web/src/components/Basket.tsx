import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";

export function Basket() {
  const items = useQuery(api.basket.list) ?? [];
  const remove = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const rm = useAsyncAction();

  return (
    <div className="panel">
      <h2>Basket</h2>
      {items.length === 0 && <p>Basket is empty.</p>}
      <ul>
        {items.map((b) => (
          <li key={b._id}>
            <span>{b.title}</span>
            <button onClick={() => rm.run(() => remove({ recipeId: b.recipeId }))}>Remove</button>
          </li>
        ))}
      </ul>
      <button onClick={() => gen.run(() => generate({}))} disabled={gen.pending || items.length === 0}>
        {gen.pending ? "Generating…" : "Generate grocery list"}
      </button>
      <ErrorText message={gen.error ?? rm.error} />
    </div>
  );
}
