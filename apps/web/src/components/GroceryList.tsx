import { api } from "@pantry/convex/api";
import { formatQuantity, groupByAisle, titleCase } from "@pantry/core";
import {
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  toggleItemOptimistic,
} from "@pantry/core/convex";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ErrorText } from "./ErrorText";
import { GroceryAddItem } from "./GroceryAddItem";
import { ProvenanceButton, ProvenanceSheet } from "./GroceryProvenance";
import { PricingSummary } from "./PricingSummary";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/useConfirm";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  // Which line's provenance sheet is open, by row id — not the row itself, so
  // the sheet keeps re-rendering from live data while it is open.
  const [showingSourcesFor, setShowingSourcesFor] = useState<string | null>(null);
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(
    clearGroceryListOptimistic,
  );
  const needItAnyway = useMutation(api.groceryList.needItAnyway).withOptimisticUpdate(
    needItAnywayOptimistic,
  );
  const removeItem = useMutation(api.groceryList.removeItem);
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

  const groups = groupByAisle(lines);
  const showingSources = lines.find((line) => line._id === showingSourcesFor);

  return (
    <Card title="Grocery list">
      {lines.length === 0 && (
        <p className="text-sm text-muted">
          Nothing yet — generate from your basket, or add something below.
        </p>
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
                    <ProvenanceButton
                      sources={line.sources}
                      onOpen={() => setShowingSourcesFor(line._id)}
                    />
                    {/* Only manual lines can be removed — a generated one comes
                        back on the next generation, so "remove" would be a lie. */}
                    {line.manual && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${line.item}`}
                        onClick={() => run(() => removeItem({ id: line._id }))}
                      >
                        Remove
                      </Button>
                    )}
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
      <PricingSummary lines={lines} />
      <div className="mt-3">
        <GroceryAddItem />
      </div>
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />
      {showingSources?.sources && (
        <ProvenanceSheet
          item={showingSources.item}
          unit={showingSources.unit}
          sources={showingSources.sources}
          onClose={() => setShowingSourcesFor(null)}
        />
      )}
      {confirmDialog}
    </Card>
  );
}
