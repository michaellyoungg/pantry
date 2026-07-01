import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const { run, error } = useAsyncAction();

  return (
    <Card title="Grocery list">
      {lines.length === 0 && <p className="text-sm text-muted">Nothing yet — generate from your basket.</p>}
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line._id}>
            <label
              className={`flex items-center gap-2 text-sm ${line.checked ? "text-muted line-through" : "text-text"}`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[--color-primary]"
                checked={line.checked}
                onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
              />
              <span>
                {line.quantity} {line.unit} {line.item}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
