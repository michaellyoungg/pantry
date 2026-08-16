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
  args: { recipeId: string; title: string; servingsMultiplier?: number },
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
      // The household default the caller derived, so the placeholder scales the
      // same way the confirmed row will — otherwise the plan's nutrition and
      // cost previews flicker between two different sizes of the same meal.
      servingsMultiplier: args.servingsMultiplier,
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

/**
 * Swipe-away delete (BL-0019). A gesture that leaves the row sitting there
 * until the server answers reads as a failed swipe, and the shopper swipes
 * again — so the row has to go the moment the finger lifts.
 */
export function removeItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"groceryList"> },
): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    cur.filter((l) => l._id !== args.id),
  );
}

/**
 * Ending a shopping trip (BL-0019). Mirrors the mutation exactly: what was
 * bought always goes, and what was not goes only if the user said so.
 */
export function finishShoppingOptimistic(
  localStore: OptimisticLocalStore,
  args: { unbought: "keep" | "remove" },
): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    args.unbought === "remove" ? [] : cur.filter((l) => !l.checked),
  );
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

/**
 * Prep task check-off (BL-0042). Like My Kitchen's checkboxes, done is a row
 * and not-done is the absence of one, so this inserts or filters rather than
 * flipping a flag — mirroring the mutation exactly.
 *
 * Without this the box is a controlled input whose `checked` cannot change
 * until the mutation round-trips, so tapping it appears to do nothing and then
 * jumps. The state is keyed on (taskKey, cookDate): the same task for next
 * week's dinner is a different tick and must not move with this one.
 */
export function setPrepTaskDoneOptimistic(
  localStore: OptimisticLocalStore,
  args: { taskKey: string; cookDate: string; done: boolean },
): void {
  const cur = localStore.getQuery(api.prepTasks.states, {});
  if (cur === undefined) return;
  const others = cur.filter((s) => !(s.taskKey === args.taskKey && s.cookDate === args.cookDate));
  localStore.setQuery(
    api.prepTasks.states,
    {},
    // Idempotent in both directions, like the server: a double-tap must not
    // stack two rows into the local cache.
    args.done
      ? [...others, { taskKey: args.taskKey, cookDate: args.cookDate, done: true }]
      : others,
  );
}
