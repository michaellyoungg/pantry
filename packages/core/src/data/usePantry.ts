import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { removePantryItemOptimistic, setPantryStateOptimistic } from "../convex/optimistic";
import { type AisleGroup, groupByAisle } from "../grocery";
import { useAsyncAction } from "../react/useAsyncAction";

/**
 * A pantry row, taken from the query's own return type rather than restated.
 * Hand-writing it would erase the `Id<"pantryItems">` brand on `_id`, and every
 * mutation below takes that brand — so the drift would only surface as a type
 * error at the call site, or not at all.
 */
export type PantryItem = FunctionReturnType<typeof api.pantry.list>[number];

export type PantryState = PantryItem["state"];

/**
 * Cycling forward from "out" wraps to "have": restocking is the common case,
 * and it keeps the whole control reachable with one repeated tap.
 */
const NEXT_STATE: Record<PantryState, PantryState> = {
  have: "low",
  low: "out",
  out: "have",
};

export type UsePantry = {
  /** Every row, in the server's aisle order. */
  items: PantryItem[];
  /** Rows grouped into consecutive aisle runs, ready to render as sections. */
  groups: AisleGroup<PantryItem>[];
  /** True until the first server response — distinct from "the pantry is empty". */
  loading: boolean;
  /** The most recent failed mutation, already stringified. */
  error: string | null;
  /** Advance a row have → low → out → have. */
  cycleState: (item: PantryItem) => void;
  /** Flip the use-it-up flag the recommender reads. */
  toggleUseItUp: (item: PantryItem) => void;
  remove: (item: PantryItem) => void;
};

/**
 * Everything the pantry screen needs, with no view attached (BL-0055).
 *
 * The Convex subscription, the three mutations and their optimistic updates,
 * the aisle grouping and the state cycle all live here so the web and native
 * pantry screens are the same data with two renderings, rather than two
 * independent wirings that drift.
 */
export function usePantry(): UsePantry {
  const data = useQuery(api.pantry.list);
  const items = data ?? [];

  const setState = useMutation(api.pantry.setState).withOptimisticUpdate(setPantryStateOptimistic);
  const removeItem = useMutation(api.pantry.remove).withOptimisticUpdate(
    removePantryItemOptimistic,
  );
  const setUseItUp = useMutation(api.pantry.setUseItUp);
  const { run, error } = useAsyncAction();

  const cycleState = useCallback(
    (item: PantryItem) => {
      run(() => setState({ id: item._id, state: NEXT_STATE[item.state] }));
    },
    [run, setState],
  );

  const toggleUseItUp = useCallback(
    (item: PantryItem) => {
      run(() => setUseItUp({ id: item._id, useItUp: !item.useItUp }));
    },
    [run, setUseItUp],
  );

  const remove = useCallback(
    (item: PantryItem) => {
      run(() => removeItem({ id: item._id }));
    },
    [run, removeItem],
  );

  return {
    items,
    // Rows arrive sorted by aisle from Convex, so this is the same consecutive
    // scan the grocery list uses — not a second grouping implementation.
    groups: groupByAisle(items),
    loading: data === undefined,
    error,
    cycleState,
    toggleUseItUp,
    remove,
  };
}
