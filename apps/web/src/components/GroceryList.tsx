import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatQuantity } from "../lib/formatQuantity";
import {
  clearGroceryListOptimistic,
  removeCheckedOptimistic,
  toggleItemOptimistic,
} from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(
    clearGroceryListOptimistic,
  );
  const removeChecked = useMutation(api.groceryList.removeChecked).withOptimisticUpdate(
    removeCheckedOptimistic,
  );
  const { run, error } = useAsyncAction();

  // Collapsed aisles + whether the "In cart" drawer and "Done shopping" panel
  // are open. Client-only view state; the list itself stays in Convex.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  // Checked items drop out of the aisle sections and collect in "In cart", so
  // the top of the list is always "what's left to grab."
  const toBuy = lines.filter((line) => !line.checked);
  const inCart = lines.filter((line) => line.checked);

  // toBuy arrives pre-sorted by aisle from recipe-service; group consecutive runs.
  const groups: { aisle: string; lines: typeof lines }[] = [];
  for (const line of toBuy) {
    const last = groups[groups.length - 1];
    if (last && last.aisle === line.aisle) last.lines.push(line);
    else groups.push({ aisle: line.aisle, lines: [line] });
  }

  function toggleAisle(aisle: string) {
    setCollapsed((c) => ({ ...c, [aisle]: !c[aisle] }));
  }

  function onClear() {
    if (!window.confirm("Clear the grocery list?")) return;
    run(() => clearList({}));
  }

  function onRemovePurchased() {
    setDoneOpen(false);
    run(() => removeChecked({}));
  }

  const renderRow = (line: (typeof lines)[number]) => (
    <li key={line._id}>
      {/* Full-row, ≥44px tap target for one-handed in-store checking. */}
      <label
        className={`-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm active:bg-border/40 ${
          line.checked ? "text-muted line-through" : "text-text"
        }`}
      >
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          checked={line.checked}
          onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
        />
        <span>
          {formatQuantity(line.quantity)} {line.unit} {line.item}
        </span>
      </label>
    </li>
  );

  return (
    <Card title="Grocery list">
      {lines.length === 0 && (
        <p className="text-sm text-muted">Nothing yet — generate from your basket.</p>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <section key={group.aisle}>
            <button
              type="button"
              onClick={() => toggleAisle(group.aisle)}
              className="flex w-full items-center justify-between py-1 text-xs font-semibold uppercase tracking-wide text-muted"
              aria-expanded={!collapsed[group.aisle]}
            >
              <span>{titleCase(group.aisle)}</span>
              <span className="tabular-nums">{group.lines.length}</span>
            </button>
            {!collapsed[group.aisle] && (
              <ul className="flex flex-col gap-1">{group.lines.map(renderRow)}</ul>
            )}
          </section>
        ))}
      </div>

      {inCart.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setCartOpen((o) => !o)}
            className="flex w-full items-center justify-between py-1 text-xs font-semibold uppercase tracking-wide text-muted"
            aria-expanded={cartOpen}
          >
            <span>In cart</span>
            <span className="tabular-nums">{inCart.length}</span>
          </button>
          {cartOpen && <ul className="flex flex-col gap-1">{inCart.map(renderRow)}</ul>}
        </div>
      )}

      {lines.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t border-border bg-surface pt-3">
          <span className="text-sm text-muted">
            {toBuy.length === 0 ? "All items in cart" : `${toBuy.length} left`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear list
            </Button>
            <Button size="sm" onClick={() => setDoneOpen(true)}>
              Done shopping
            </Button>
          </div>
        </div>
      )}

      {doneOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-bg p-3">
          <p className="text-sm text-text">Finished shopping?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRemovePurchased} disabled={inCart.length === 0}>
              Remove purchased ({inCart.length})
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDoneOpen(false)}>
              Keep list
            </Button>
          </div>
        </div>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
