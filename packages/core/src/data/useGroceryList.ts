import { api } from "@pantry/convex/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  clearGroceryListOptimistic,
  finishShoppingOptimistic,
  needItAnywayOptimistic,
  removeItemOptimistic,
  toggleItemOptimistic,
} from "../convex/optimistic";
import {
  type AisleGroup,
  changedLineIds,
  groupByAisle,
  partitionCart,
  partitionRemoved,
} from "../grocery";
import { parseManualEntry } from "../manualEntry";
import { useAsyncAction } from "../react/useAsyncAction";

/**
 * A grocery line, taken from the query's own return type rather than restated.
 * Hand-writing it would erase the `Id<"groceryList">` brand on `_id`, which
 * every mutation here takes — the sort of drift only `tsc` catches.
 */
export type GroceryLine = FunctionReturnType<typeof api.groceryList.getGroceryList>[number];

/** An unanswered "did this leave a leftover?" prompt. */
export type LeftoverProposal = FunctionReturnType<typeof api.groceryList.leftoverProposals>[number];

/** A one-tap add suggestion — something this household has bought before. */
export type RecentItem = FunctionReturnType<typeof api.groceryList.recentItems>[number];

/** What ending a trip does with the lines that were never checked off. */
export type FinishChoice = "keep" | "remove";

/**
 * What a delete takes with it, and `restoreItem` puts back.
 *
 * Picked field by field rather than spread-minus-system-fields: the mutation
 * validator rejects anything it does not name, so a column added to the table
 * later must be added here deliberately rather than silently riding along and
 * breaking undo. Picking *from the row type* is what makes a rename of an
 * existing column a compile error rather than a silent drop.
 */
export type RestorableLine = Pick<
  GroceryLine,
  | "item"
  | "canonicalItem"
  | "unit"
  | "quantity"
  | "aisle"
  | "checked"
  | "alreadyHave"
  | "shelfLifeDays"
  | "sources"
  | "purchase"
  | "leftoverDecision"
  | "manual"
  | "removed"
>;

function snapshotOf(line: GroceryLine): RestorableLine {
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

/** How long a ticked line is held in the aisle walk while it animates out. */
export const CART_TRANSITION_MS = 300;

/** How long another shopper's edit stays flagged. */
export const REMOTE_HIGHLIGHT_MS = 1500;

/** How long the undo offer stands after a line is swiped away. */
export const UNDO_MS = 8_000;

/**
 * Which lines are mid-flight from the aisle walk into the cart.
 *
 * A ticked line has to be seen leaving, or it simply teleports to a section
 * further down the page and the shopper cannot tell whether their tap landed on
 * the row they meant. Holding it in place for the length of the animation is
 * the whole trick — the duration is shared, the animation itself is each
 * platform's own.
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
 * a phone reads as the list mutating on its own. The hook registers every edit
 * this device makes in `own`, and whatever is left over is by definition
 * somebody else's and gets flagged.
 *
 * An id is *consumed* from `own` the first time it explains a change, so a line
 * this device ticked stays eligible to be highlighted the next time the other
 * shopper touches it.
 */
function useRemoteHighlight(
  lines: readonly GroceryLine[],
  own: RefObject<Set<string>>,
  ready: boolean,
): Set<string> {
  const previous = useRef<GroceryLine[] | null>(null);
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

export type UseGroceryList = {
  /** Every line, in the server's aisle order. */
  lines: GroceryLine[];
  /** True until the first server response — distinct from "the list is empty". */
  loading: boolean;
  /** The half still being shopped for: everything the plan has not dropped. */
  active: GroceryLine[];
  /** Lines the plan dropped after the shopper had already checked them off. */
  removed: GroceryLine[];
  /** Still to buy — a ticked line stays here until it has finished animating. */
  toBuy: GroceryLine[];
  /** Already in the cart. */
  inCart: GroceryLine[];
  /** `toBuy`, grouped into the store walk. */
  groups: AisleGroup<GroceryLine>[];
  /** Unanswered leftover prompts; the finish sheet warns when any are left. */
  pendingLeftovers: LeftoverProposal[];
  /** Things this household buys, for one-tap adding without typing. */
  recentItems: RecentItem[];
  /** Ids mid-flight out of the walk, for however the platform animates that. */
  leaving: ReadonlySet<string>;
  /** Ids another shopper changed just now. */
  highlighted: ReadonlySet<string>;
  /** The last swiped-away line while its undo offer stands, else null. */
  undo: RestorableLine | null;
  /** The most recent failed mutation, already stringified. */
  error: string | null;
  /**
   * True while a write is in flight — i.e. from the moment a mutation is fired
   * until the server acknowledges it.
   *
   * Every write here is optimistic, so the rendered state flips before the
   * server has seen anything. This is the only signal that separates "the UI
   * says so" from "the backend agreed", which is what a platform needs to show
   * a spinner, and what an e2e test needs before it may reload the page — a
   * reload drops the Convex socket and cancels anything not yet flushed.
   */
  pending: boolean;
  toggle: (line: GroceryLine, checked: boolean) => void;
  /** Deletes now; `undoRemove` puts it back for the next {@link UNDO_MS}. */
  remove: (line: GroceryLine) => void;
  undoRemove: () => void;
  needItAnyway: (line: GroceryLine) => void;
  /**
   * Adds one line from what the shopper typed into the add box.
   *
   * Takes the raw text rather than a parsed entry: splitting "2 lb butter" into
   * quantity/unit/item is `parseManualEntry`'s job, and a view that did it
   * first would be the second place that decision lives. Blank input is a
   * no-op, so a stray tap on an empty field cannot post a nameless line.
   */
  addManual: (typed: string) => void;
  /** Answers one inferred-leftover guess. Each is answered on its own. */
  resolveLeftover: (proposal: LeftoverProposal, keep: boolean) => void;
  /** Deletes every line. Callers confirm first — the prompt is per-platform. */
  clear: () => void;
  finish: (unbought: FinishChoice) => void;
};

/**
 * Everything the grocery list screen needs, with no view attached (BL-0055).
 *
 * Three subscriptions, seven mutations plus one action with their optimistic
 * updates, the cart and dropped-line partitions, the two transient-highlight
 * timers and the undo window all live here, so the web and native grocery
 * screens render the same state rather than each re-deriving it.
 *
 * What deliberately stays in the view: which sheet is open, whether the add
 * field is expanded, and the confirmation prompt before {@link clear} — those
 * are presentation, and the prompt has no cross-platform form.
 */
export function useGroceryList(): UseGroceryList {
  const data = useQuery(api.groceryList.getGroceryList);
  const lines = data ?? [];
  // Shared with the leftovers prompt rather than re-derived: Convex dedupes the
  // subscription, and the predicate for "still unanswered" belongs in one place.
  const pendingLeftovers = useQuery(api.groceryList.leftoverProposals) ?? [];
  // The add box's suggestions. Subscribed here rather than inside the add
  // field so both clients' add fields are pure presentation over one wiring.
  const recentItems = useQuery(api.groceryList.recentItems) ?? [];

  const [undo, setUndo] = useState<RestorableLine | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleItem = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(
    toggleItemOptimistic,
  );
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(
    clearGroceryListOptimistic,
  );
  const needItAnywayMutation = useMutation(api.groceryList.needItAnyway).withOptimisticUpdate(
    needItAnywayOptimistic,
  );
  const removeItem = useMutation(api.groceryList.removeItem).withOptimisticUpdate(
    removeItemOptimistic,
  );
  const restoreItem = useMutation(api.groceryList.restoreItem);
  const resolveLeftoverMutation = useMutation(api.groceryList.resolveLeftover);
  // An action, not a mutation: adding by hand calls out to recipe-service to
  // normalize the typed name, so a typed "scallions" files itself beside a
  // recipe's "green onion" instead of landing in the catch-all aisle.
  const addManualItem = useAction(api.groceryList.addManualItem);
  const finishShopping = useMutation(api.groceryList.finishShopping).withOptimisticUpdate(
    finishShoppingOptimistic,
  );
  const { run, error, pending } = useAsyncAction();

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
  // and the flagged half is surfaced apart, as something to acknowledge.
  const { active, removed } = partitionRemoved(lines);
  const leaving = useCartTransition(
    active.filter((line) => line.checked).map((line) => line._id),
    data !== undefined,
  );
  const highlighted = useRemoteHighlight(lines, ownEdits, data !== undefined);
  // A line that has been ticked but is still animating stays in the walk.
  const { toBuy, inCart } = partitionCart(active, (line) => line.checked && !leaving.has(line._id));

  const toggle = useCallback(
    (line: GroceryLine, checked: boolean) => {
      ownEdits.current.add(line._id);
      run(() => toggleItem({ id: line._id, checked }));
    },
    [run, toggleItem],
  );

  // Delete now, undo later — rather than the usual trick of holding the delete
  // behind a timer. A shopper who swipes and then pockets their phone must get
  // what they asked for, and a pending delete that lives in a component dies
  // with it.
  const remove = useCallback(
    (line: GroceryLine) => {
      setUndo(snapshotOf(line));
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      run(() => removeItem({ id: line._id }));
    },
    [run, removeItem],
  );

  const undoRemove = useCallback(() => {
    if (undo === null) return;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    run(() => restoreItem({ line: undo }));
  }, [undo, run, restoreItem]);

  const needItAnyway = useCallback(
    (line: GroceryLine) => {
      run(() => needItAnywayMutation({ id: line._id }));
    },
    [run, needItAnywayMutation],
  );

  const addManual = useCallback(
    (typed: string) => {
      const entry = parseManualEntry(typed);
      // "  " parses to a nameless line, and the action would reject it. Failing
      // silently here keeps a stray tap from raising an error the shopper did
      // nothing to deserve.
      if (entry.item === "") return;
      run(() => addManualItem(entry));
    },
    [run, addManualItem],
  );

  const resolveLeftover = useCallback(
    (proposal: LeftoverProposal, keep: boolean) => {
      run(() => resolveLeftoverMutation({ id: proposal._id, keep }));
    },
    [run, resolveLeftoverMutation],
  );

  const clear = useCallback(() => {
    run(() => clearList({}));
  }, [run, clearList]);

  const finish = useCallback(
    (unbought: FinishChoice) => {
      run(() => finishShopping({ unbought }));
    },
    [run, finishShopping],
  );

  return {
    lines,
    loading: data === undefined,
    active,
    removed,
    toBuy,
    inCart,
    groups: groupByAisle(toBuy),
    pendingLeftovers,
    recentItems,
    leaving,
    highlighted,
    undo,
    error,
    pending,
    toggle,
    remove,
    undoRemove,
    needItAnyway,
    addManual,
    resolveLeftover,
    clear,
    finish,
  };
}
