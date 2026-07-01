import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic, clearGroceryListOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(clearGroceryListOptimistic);
  const { run, error } = useAsyncAction();

  function onClear() {
    if (!window.confirm("Clear the grocery list?")) return;
    run(() => clearList({}));
  }

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
                className="h-4 w-4 accent-[var(--color-primary)]"
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
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
