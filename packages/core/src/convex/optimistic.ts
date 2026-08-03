import { api } from "@pantry/convex/api";
import type { Id } from "@pantry/convex/dataModel";
import type { OptimisticLocalStore } from "convex/browser";

export function toggleItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"groceryList">; checked: boolean },
): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    cur.map((l) => (l._id === args.id ? { ...l, checked: args.checked } : l)),
  );
}

export function removeFromBasketOptimistic(
  localStore: OptimisticLocalStore,
  args: { recipeId: string },
): void {
  const cur = localStore.getQuery(api.basket.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.basket.list,
    {},
    cur.filter((b) => b.recipeId !== args.recipeId),
  );
}

export function addToBasketOptimistic(
  localStore: OptimisticLocalStore,
  args: { recipeId: string; title: string },
): void {
  const cur = localStore.getQuery(api.basket.list, {});
  if (cur === undefined) return;
  if (cur.some((b) => b.recipeId === args.recipeId)) return; // server add is idempotent
  localStore.setQuery(api.basket.list, {}, [
    ...cur,
    {
      // Placeholder system/owner fields; overwritten when the server confirms.
      // No `weekday`, so it lands on the unscheduled rail like a real fresh add.
      _id: `optimistic-${args.recipeId}` as Id<"basket">,
      _creationTime: 0,
      userId: "",
      recipeId: args.recipeId,
      title: args.title,
    },
  ]);
}

/**
 * My Kitchen's checkboxes (BL-0043). Owning something is a row and not owning
 * it is the absence of one, so this inserts or filters rather than flipping a
 * flag — mirroring the mutation exactly.
 *
 * Idempotent in both directions, like the server: a double-tap must not stack
 * two rows into the local cache and make the list flicker on confirmation.
 */
export function setEquipmentOwnedOptimistic(
  localStore: OptimisticLocalStore,
  args: { equipmentId: string; owned: boolean },
): void {
  const cur = localStore.getQuery(api.equipment.list, {});
  if (cur === undefined) return;
  if (!args.owned) {
    localStore.setQuery(
      api.equipment.list,
      {},
      cur.filter((e) => e.equipmentId !== args.equipmentId),
    );
    return;
  }
  if (cur.some((e) => e.equipmentId === args.equipmentId)) return;
  // Prepended, because the query is ordered newest-acquired first.
  localStore.setQuery(api.equipment.list, {}, [
    {
      // Placeholder system/owner fields; overwritten when the server confirms.
      _id: `optimistic-${args.equipmentId}` as Id<"equipmentInventory">,
      _creationTime: 0,
      userId: "",
      equipmentId: args.equipmentId,
      addedAt: Date.now(),
    },
    ...cur,
  ]);
}

export function clearGroceryListOptimistic(localStore: OptimisticLocalStore): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(api.groceryList.getGroceryList, {}, []);
}

export function needItAnywayOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"groceryList"> },
): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    cur.map((l) => (l._id === args.id ? { ...l, alreadyHave: false } : l)),
  );
}

export function setPantryStateOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"pantryItems">; state: "have" | "low" | "out" },
): void {
  const cur = localStore.getQuery(api.pantry.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.pantry.list,
    {},
    cur.map((p) => (p._id === args.id ? { ...p, state: args.state } : p)),
  );
}

export function removePantryItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"pantryItems"> },
): void {
  const cur = localStore.getQuery(api.pantry.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.pantry.list,
    {},
    cur.filter((p) => p._id !== args.id),
  );
}
