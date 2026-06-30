import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@pantry/convex/api";

export function Basket() {
  const items = useQuery(api.basket.list) ?? [];
  const remove = useMutation(api.basket.remove);
  const generate = useAction(api.recipes.generateGroceryList);
  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    setBusy(true);
    try {
      await generate({});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Basket</h2>
      {items.length === 0 && <p>Basket is empty.</p>}
      <ul>
        {items.map((b) => (
          <li key={b._id}>
            <span>{b.title}</span>
            <button onClick={() => remove({ recipeId: b.recipeId })}>Remove</button>
          </li>
        ))}
      </ul>
      <button onClick={onGenerate} disabled={busy || items.length === 0}>
        {busy ? "Generating…" : "Generate grocery list"}
      </button>
    </div>
  );
}
