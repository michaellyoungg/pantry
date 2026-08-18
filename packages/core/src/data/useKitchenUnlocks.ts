import { api } from "@pantry/convex/api";
import type { EquipmentMatch } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { addToBasketOptimistic } from "../convex/optimistic";
import { useAsyncAction } from "../react/useAsyncAction";
import { useAsyncData } from "../react/useAsyncData";

/** `equipment.unlockedBy`. Injectable so web can pass its traced wrapper. */
export type UnlockedBy = (
  args: FunctionArgs<typeof api.equipment.unlockedBy>,
) => Promise<FunctionReturnType<typeof api.equipment.unlockedBy>>;

export type UseKitchenUnlocks = {
  /** Recipes this one device made possible. Empty is an ordinary answer. */
  recipes: EquipmentMatch[];
  loading: boolean;
  /** A failed lookup, already stringified. */
  error: string | null;
  /** The most recent failed basket write, already stringified. */
  addError: string | null;
  reload: () => void;
  addToBasket: (recipe: EquipmentMatch) => void;
};

/**
 * "I just got a panini press — what can I make?" (BL-0043), with no view
 * attached.
 *
 * Deliberately scoped to what the device *changed*: recipes that were already
 * cookable are excluded server-side, because being told you can now make the
 * roast chicken you have always been able to make is not a discovery. An empty
 * result is therefore a real, common answer — the catalog simply has nothing
 * that needs this device — and callers word it as such rather than as a failure.
 */
export function useKitchenUnlocks(
  equipmentId: string,
  { unlockedBy }: { unlockedBy?: UnlockedBy } = {},
): UseKitchenUnlocks {
  const unlockedByAction = useAction(api.equipment.unlockedBy);
  const fetchUnlocked = unlockedBy ?? unlockedByAction;
  const addToBasketMutation = useMutation(api.basket.add).withOptimisticUpdate(
    addToBasketOptimistic,
  );

  const load = useCallback(() => fetchUnlocked({ equipmentId }), [fetchUnlocked, equipmentId]);
  const { data, loading, error, reload } = useAsyncData(load, [equipmentId]);
  const { run, error: addError } = useAsyncAction();

  const addToBasket = useCallback(
    (recipe: EquipmentMatch) => {
      void run(() => addToBasketMutation({ recipeId: recipe.id, title: recipe.title }));
    },
    [run, addToBasketMutation],
  );

  return { recipes: data ?? [], loading, error, addError, reload, addToBasket };
}
