import { api } from "@pantry/convex/api";
import {
  formatQuantity,
  groupByAisle,
  partitionRemoved,
  purchaseText,
  titleCase,
} from "@pantry/core";
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
import { LeftoverProposals } from "./LeftoverProposals";
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

  // Regeneration flags lines the plan dropped after they were checked off
  // rather than deleting them (BL-0018), so the store walk is the active half
  // and the flagged half is shown apart, below, as something to acknowledge.
  const { active, removed } = partitionRemoved(lines);
  const groups = groupByAisle(active);
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
              {group.lines.map((line) => {
                // What the shop sells comes first — it is what the shopper has
                // to find and put in the basket. The recipes' measure is kept
                // beside it, quieter: it is why the line exists, and dropping
                // it would make the list unverifiable against the plan.
                const { buy, need } = purchaseText(line, formatQuantity);
                return (
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
                          {buy} {line.item}
                          {need && <span className="ml-1 text-xs text-muted">needs {need}</span>}
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
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {removed.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            No longer in your plan
          </h3>
          <p className="mt-1 text-xs text-muted">
            You had already checked these off when the plan changed, so they were kept rather than
            deleted.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {removed.map((line) => (
              <li key={line._id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-muted line-through">
                  {formatQuantity(line.quantity)} {line.unit} {line.item}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Dismiss ${line.item}`}
                  onClick={() => run(() => removeItem({ id: line._id }))}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Sits below the walk and above the total: it only has anything to say
          once lines have been checked off, which is the end of a shop. */}
      <LeftoverProposals />
      {/* Priced over the active half only: a flagged line is already bought, so
          folding it into "what this trip costs" would double-count it. */}
      <PricingSummary lines={active} />
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
