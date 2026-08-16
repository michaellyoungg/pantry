import { api } from "@pantry/convex/api";
import type { Doc } from "@pantry/convex/dataModel";
import {
  changedLineIds,
  formatQuantity,
  groupByAisle,
  partitionCart,
  partitionRemoved,
  titleCase,
} from "@pantry/core";
import {
  clearGroceryListOptimistic,
  finishShoppingOptimistic,
  needItAnywayOptimistic,
  removeItemOptimistic,
  toggleItemOptimistic,
} from "@pantry/core/convex";
import { useAsyncAction } from "@pantry/core/react";
import { useMutation, useQuery } from "convex/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { DoneShoppingSheet, type FinishChoice } from "./DoneShoppingSheet";
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

type Line = Doc<"groceryList">;

/** Paired with `.grocery-leaving` in index.css: the row is held in the walk for
 *  exactly as long as its animation out of it runs. */
const CART_TRANSITION_MS = 300;

/** Paired with `.grocery-remote`. */
const REMOTE_HIGHLIGHT_MS = 1500;

/** How long the undo offer stands after a line is swiped away. */
const UNDO_MS = 8_000;

/** What a delete takes with it, and `restoreItem` puts back. */
type RestorableLine = {
  item: string;
  canonicalItem?: string;
  unit: string;
  quantity: number;
  aisle: string;
  checked: boolean;
  alreadyHave?: boolean;
  shelfLifeDays?: number;
  sources?: { recipeId: string; title: string; quantity: number }[];
  purchase?: { quantity: number; unit: string; residue?: number; residueUnit?: string };
  leftoverDecision?: "kept" | "dismissed";
  manual?: boolean;
  removed?: boolean;
};

/**
 * Picked field by field rather than spread-minus-system-fields: the mutation
 * validator rejects anything it does not name, so a column added to the table
 * later must be added here deliberately rather than silently riding along and
 * breaking undo.
 */
function snapshotOf(line: Line): RestorableLine {
  return {
    item: line.item,
    canonicalItem: line.canonicalItem,
    unit: line.unit,
    quantity: line.quantity,
    aisle: line.aisle,
    checked: line.checked,
    alreadyHave: line.alreadyHave,
    shelfLifeDays: line.shelfLifeDays,
    sources: line.sources,
    purchase: line.purchase,
    leftoverDecision: line.leftoverDecision,
    manual: line.manual,
    removed: line.removed,
  };
}

/**
 * Which lines are mid-flight from the aisle walk into the cart.
 *
 * A ticked line has to be seen leaving, or it simply teleports to a section
 * further down the page and the shopper cannot tell whether their tap landed on
 * the row they meant. Holding it in place for the length of the animation is
 * the whole trick.
 *
 * Timers are never cancelled on a re-run, only on unmount: two lines ticked
 * within the same 300ms would otherwise have the first one's timer cleared by
 * the second, stranding it in the walk permanently.
 */
function useCartTransition(checkedIds: string[], ready: boolean): Set<string> {
  const key = checkedIds.join("|");
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next = new Set(key === "" ? [] : key.split("|"));
    const previous = seen.current;
    seen.current = next;
    // The first list we are handed is not a list of things that just happened.
    if (previous === null) return;
    const fresh = [...next].filter((id) => !previous.has(id));
    if (fresh.length === 0) return;

    setLeaving((current) => new Set([...current, ...fresh]));
    timers.current.push(
      setTimeout(() => {
        setLeaving((current) => {
          const rest = new Set(current);
          for (const id of fresh) rest.delete(id);
          return rest;
        });
      }, CART_TRANSITION_MS),
    );
  }, [key, ready]);

  return leaving;
}

/**
 * Lines somebody else changed just now.
 *
 * Convex has always kept two phones in a shop in sync, but silently — which on
 * a phone reads as the list mutating on its own. The caller registers every
 * edit it makes itself in `own`, and whatever is left over is by definition
 * somebody else's and gets flashed.
 *
 * An id is *consumed* from `own` the first time it explains a change, so a line
 * this device ticked stays eligible to be highlighted the next time the other
 * shopper touches it.
 */
function useRemoteHighlight(
  lines: readonly Line[],
  own: RefObject<Set<string>>,
  ready: boolean,
): Set<string> {
  const previous = useRef<Line[] | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const before = previous.current;
    previous.current = [...lines];
    if (before === null) return;
    const remote = changedLineIds(before, lines).filter((id) => {
      if (own.current.has(id)) {
        own.current.delete(id);
        return false;
      }
      return true;
    });
    if (remote.length === 0) return;

    setHighlighted((current) => new Set([...current, ...remote]));
    timers.current.push(
      setTimeout(() => {
        setHighlighted((current) => {
          const rest = new Set(current);
          for (const id of remote) rest.delete(id);
          return rest;
        });
      }, REMOTE_HIGHLIGHT_MS),
    );
  }, [lines, own, ready]);

  return highlighted;
}

export function GroceryList() {
  const data = useQuery(api.groceryList.getGroceryList);
  const lines = data ?? [];
  // Shared with LeftoverProposals rather than re-derived: Convex dedupes the
  // subscription, and the predicate for "still unanswered" belongs in one place.
  const pendingLeftovers = useQuery(api.groceryList.leftoverProposals) ?? [];

  // Which line's provenance sheet is open, by row id — not the row itself, so
  // the sheet keeps re-rendering from live data while it is open.
  const [showingSourcesFor, setShowingSourcesFor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [undo, setUndo] = useState<RestorableLine | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(
    clearGroceryListOptimistic,
  );
  const needItAnyway = useMutation(api.groceryList.needItAnyway).withOptimisticUpdate(
    needItAnywayOptimistic,
  );
  const removeItem = useMutation(api.groceryList.removeItem).withOptimisticUpdate(
    removeItemOptimistic,
  );
  const restoreItem = useMutation(api.groceryList.restoreItem);
  const finishShopping = useMutation(api.groceryList.finishShopping).withOptimisticUpdate(
    finishShoppingOptimistic,
  );
  const { run, error } = useAsyncAction();
  const { confirm, confirmDialog } = useConfirm();

  // Every id this device changed itself, so the highlight can tell a household
  // member's edit from the user's own tap.
  const ownEdits = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  // Regeneration flags lines the plan dropped after they were checked off
  // (BL-0018) rather than deleting them, so the store walk is the active half
  // and the flagged half is shown apart, below, as something to acknowledge.
  const { active, removed } = partitionRemoved(lines);
  const leaving = useCartTransition(
    active.filter((line) => line.checked).map((line) => line._id),
    data !== undefined,
  );
  const highlighted = useRemoteHighlight(lines, ownEdits, data !== undefined);
  // A line that has been ticked but is still animating stays in the walk.
  const { toBuy, inCart } = partitionCart(active, (line) => line.checked && !leaving.has(line._id));
  const groups = groupByAisle(toBuy);
  const showingSources = lines.find((line) => line._id === showingSourcesFor);

  function onToggle(line: Line, checked: boolean) {
    ownEdits.current.add(line._id);
    run(() => toggle({ id: line._id, checked }));
  }

  // Delete now, undo later — rather than the usual trick of holding the delete
  // behind a timer. A shopper who swipes and then pockets their phone must get
  // what they asked for, and a pending delete that lives in a component dies
  // with it.
  function onRemove(line: Line) {
    setUndo(snapshotOf(line));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    run(() => removeItem({ id: line._id }));
  }

  function onUndo(line: RestorableLine) {
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    run(() => restoreItem({ line }));
  }

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

  function onFinish(choice: FinishChoice) {
    setFinishing(false);
    run(() => finishShopping({ unbought: choice }));
  }

  return (
    <Card title="Grocery list">
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
                  onToggle={(checked) => onToggle(line, checked)}
                  onOpenSources={() => setShowingSourcesFor(line._id)}
                  // Only manual lines can be removed — a generated one comes
                  // back on the next generation, so "remove" would be a lie.
                  onRemove={line.manual ? () => onRemove(line) : undefined}
                  onNeedItAnyway={() => run(() => needItAnyway({ id: line._id }))}
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
                  onToggle={(checked) => onToggle(line, checked)}
                  onOpenSources={() => setShowingSourcesFor(line._id)}
                  onRemove={line.manual ? () => onRemove(line) : undefined}
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
                  onRemove={() => onRemove(line)}
                >
                  <span className="flex min-h-11 flex-1 items-center text-sm text-muted line-through">
                    {formatQuantity(line.quantity)} {line.unit} {line.item}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    aria-label={`Dismiss ${line.item}`}
                    onClick={() => onRemove(line)}
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
      <LeftoverProposals />
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
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onUndo(undo)}>
              Undo
            </Button>
          </div>
        )}
        {adding && (
          <div className="mb-2">
            <GroceryAddItem />
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
          onChoose={onFinish}
          onCancel={() => setFinishing(false)}
        />
      )}
      {confirmDialog}
    </Card>
  );
}
