import { formatQuantity, titleCase } from "@pantry/core";
import { useGroceryList } from "@pantry/core/data";
import { useState } from "react";
import { DoneShoppingSheet } from "./DoneShoppingSheet";
import { ErrorText } from "./ErrorText";
import { GroceryAddItem } from "./GroceryAddItem";
import { ProvenanceSheet } from "./GroceryProvenance";
import { GroceryRow } from "./GroceryRow";
import { LeftoverProposals } from "./LeftoverProposals";
import { PricingSummary } from "./PricingSummary";
import { ShoppingPresence } from "./ShoppingPresence";
import { SwipeAwayRow } from "./SwipeAwayRow";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { CollapsibleSection } from "./ui/CollapsibleSection";
import { useConfirm } from "./ui/useConfirm";

/**
 * The grocery list screen (BL-0055): presentation over `useGroceryList()`.
 *
 * Both subscriptions, the six mutations and their optimistic updates, the cart
 * and dropped-line partitions, the two transient-highlight windows and the undo
 * offer all live in `@pantry/core/data`, so the native grocery screen renders
 * the same state rather than re-deriving it.
 *
 * The add field and the leftover prompt are presentation over the same hook
 * (BL-0057) rather than components that subscribe on their own, so the native
 * screen drives one copy of that wiring rather than a second.
 *
 * What is left here is genuinely per-platform: `.grocery-leaving` and
 * `.grocery-remote` are the web's rendering of `leaving`/`highlighted`, which
 * sheet is open is view state, and the clear confirmation is a web dialog — the
 * hook exposes `clear()` and lets each client ask in its own way.
 */
export function GroceryList() {
  const {
    lines,
    active,
    removed,
    inCart,
    toBuy,
    groups,
    pendingLeftovers,
    pending,
    recentItems,
    leaving,
    highlighted,
    undo,
    error,
    toggle,
    remove,
    undoRemove,
    needItAnyway,
    addManual,
    resolveLeftover,
    clear,
    finish,
  } = useGroceryList();

  // Which line's provenance sheet is open, by row id — not the row itself, so
  // the sheet keeps re-rendering from live data while it is open.
  const [showingSourcesFor, setShowingSourcesFor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [adding, setAdding] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const showingSources = lines.find((line) => line._id === showingSourcesFor);

  async function onClear() {
    const cleared = await confirm({
      title: "Clear the grocery list?",
      message: "Every line goes, including the ones you have already checked off.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!cleared) return;
    clear();
  }

  return (
    // aria-busy marks the window between firing an (optimistic) write and the
    // server acknowledging it. Assistive tech gets told the region is settling,
    // and the e2e suite gets the one signal that distinguishes "the checkbox
    // looks ticked" from "the backend stored it" — see `pending` on
    // useGroceryList().
    <Card title="Grocery list" label="Grocery list" busy={pending}>
      <ShoppingPresence />
      {lines.length === 0 && (
        <p className="text-sm text-muted">
          Nothing yet — generate from your basket, or add something below.
        </p>
      )}
      <div className="mt-2 flex flex-col gap-3">
        {groups.map((group) => (
          <CollapsibleSection
            key={group.aisle}
            title={titleCase(group.aisle)}
            count={group.lines.length}
            countLabel={group.lines.length === 1 ? "item to buy" : "items to buy"}
          >
            <ul className="flex flex-col gap-1">
              {group.lines.map((line) => (
                <GroceryRow
                  key={line._id}
                  line={line}
                  leaving={leaving.has(line._id)}
                  highlighted={highlighted.has(line._id)}
                  onToggle={(checked) => toggle(line, checked)}
                  onOpenSources={() => setShowingSourcesFor(line._id)}
                  // Only manual lines can be removed — a generated one comes
                  // back on the next generation, so "remove" would be a lie.
                  onRemove={line.manual ? () => remove(line) : undefined}
                  onNeedItAnyway={() => needItAnyway(line)}
                />
              ))}
            </ul>
          </CollapsibleSection>
        ))}
      </div>
      {inCart.length > 0 && (
        <div className="mt-3">
          <CollapsibleSection
            title="In cart"
            count={inCart.length}
            countLabel={inCart.length === 1 ? "item" : "items"}
            description="Checked off, and already added to your pantry."
          >
            <ul className="flex flex-col gap-1">
              {inCart.map((line) => (
                <GroceryRow
                  key={line._id}
                  line={line}
                  highlighted={highlighted.has(line._id)}
                  onToggle={(checked) => toggle(line, checked)}
                  onOpenSources={() => setShowingSourcesFor(line._id)}
                  onRemove={line.manual ? () => remove(line) : undefined}
                />
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}
      {removed.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-3">
          <CollapsibleSection
            title="No longer in your plan"
            count={removed.length}
            countLabel={removed.length === 1 ? "dropped line" : "dropped lines"}
            description="You had already checked these off when the plan changed, so they were kept rather than deleted."
          >
            <ul className="mt-2 flex flex-col gap-1">
              {removed.map((line) => (
                <SwipeAwayRow
                  key={line._id}
                  removeLabel="Dismiss"
                  highlighted={highlighted.has(line._id)}
                  onRemove={() => remove(line)}
                >
                  <span className="flex min-h-11 flex-1 items-center text-sm text-muted line-through">
                    {formatQuantity(line.quantity)} {line.unit} {line.item}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    aria-label={`Dismiss ${line.item}`}
                    onClick={() => remove(line)}
                  >
                    Dismiss
                  </Button>
                </SwipeAwayRow>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}
      {/* Sits below the walk and above the total: it only has anything to say
          once lines have been checked off, which is the end of a shop. */}
      <LeftoverProposals proposals={pendingLeftovers} onResolve={resolveLeftover} />
      {/* Priced over the active half only: a flagged line is already bought, so
          folding it into "what this trip costs" would double-count it. */}
      <PricingSummary lines={active} />
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />

      {/* The thumb zone. Everything global to the list — what is left, adding
          something, ending the trip — is pinned to the bottom of the screen
          where a hand holding a phone in a shop can actually reach it. The
          offset clears the mobile nav bar, which is fixed at the very bottom. */}
      <div className="sticky bottom-16 z-10 -mx-5 -mb-5 mt-4 border-t border-border bg-surface px-5 py-3 sm:bottom-0">
        {undo && (
          <div
            role="status"
            className="mb-2 flex items-center gap-2 rounded-lg bg-border/60 px-3 py-2 text-sm text-text"
          >
            <span className="flex-1">Removed {undo.item}</span>
            <Button variant="secondary" size="sm" className="min-h-11" onClick={undoRemove}>
              Undo
            </Button>
          </div>
        )}
        {adding && (
          <div className="mb-2">
            <GroceryAddItem recent={recentItems} onAdd={addManual} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-muted">
            {active.length === 0
              ? "Nothing on the list"
              : `${inCart.length} of ${active.length} in cart`}
          </p>
          <Button
            variant="secondary"
            className="min-h-11"
            aria-expanded={adding}
            onClick={() => setAdding((wasAdding) => !wasAdding)}
          >
            {adding ? "Close" : "Add item"}
          </Button>
          <Button
            variant="primary"
            className="min-h-11"
            disabled={lines.length === 0}
            onClick={() => setFinishing(true)}
          >
            Done shopping
          </Button>
        </div>
      </div>

      {showingSources?.sources && (
        <ProvenanceSheet
          item={showingSources.item}
          unit={showingSources.unit}
          sources={showingSources.sources}
          onClose={() => setShowingSourcesFor(null)}
        />
      )}
      {finishing && (
        <DoneShoppingSheet
          inCart={inCart.length}
          stillToBuy={toBuy.length}
          unansweredLeftovers={pendingLeftovers.length}
          onChoose={(choice) => {
            setFinishing(false);
            finish(choice);
          }}
          onCancel={() => setFinishing(false)}
        />
      )}
      {confirmDialog}
    </Card>
  );
}
