import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const { run, error } = useAsyncAction();

  return (
    <div className="panel">
      <h2>Grocery list</h2>
      {lines.length === 0 && <p>Nothing yet — generate from your basket.</p>}
      <ul>
        {lines.map((line) => (
          <li key={line._id}>
            <label style={{ textDecoration: line.checked ? "line-through" : "none" }}>
              <input
                type="checkbox"
                checked={line.checked}
                onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
              />
              {line.quantity} {line.unit} {line.item}
            </label>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </div>
  );
}
