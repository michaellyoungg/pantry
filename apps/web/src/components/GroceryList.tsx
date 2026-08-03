import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { formatQuantity } from "../lib/formatQuantity";
import {
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  toggleItemOptimistic,
} from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/useConfirm";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(
    clearGroceryListOptimistic,
  );
  const needItAnyway = useMutation(api.groceryList.needItAnyway).withOptimisticUpdate(
    needItAnywayOptimistic,
  );
  const { run, error } = useAsyncAction();
  const { confirm, confirmDialog } = useConfirm();

  async function onClear() {
    const cleared = await confirm({
      title: "Clear the grocery list?",
      message: "Every line goes, including the ones you have already checked off.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!cleared) return;
    run(() => clearList({}));
  }

  // Lines arrive pre-sorted by aisle from recipe-service; group consecutive runs.
  const groups: { aisle: string; lines: typeof lines }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === line.aisle) last.lines.push(line);
    else groups.push({ aisle: line.aisle, lines: [line] });
  }

  return (
    <Card title="Grocery list">
      {lines.length === 0 && (
        <p className="text-sm text-muted">Nothing yet — generate from your basket.</p>
      )}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.aisle}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {titleCase(group.aisle)}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.lines.map((line) => (
                <li key={line._id}>
                  <div className="flex items-center gap-2">
                    <label
                      className={`flex flex-1 items-center gap-2 text-sm ${
                        line.checked
                          ? "text-muted line-through"
                          : line.alreadyHave
                            ? "text-muted"
                            : "text-text"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary)]"
                        checked={line.checked}
                        onChange={(e) =>
                          run(() => toggle({ id: line._id, checked: e.target.checked }))
                        }
                      />
                      <span>
                        {formatQuantity(line.quantity)} {line.unit} {line.item}
                      </span>
                    </label>
                    {line.alreadyHave && (
                      <>
                        <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                          already have
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(() => needItAnyway({ id: line._id }))}
                        >
                          Need it anyway
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />
      {confirmDialog}
    </Card>
  );
}
