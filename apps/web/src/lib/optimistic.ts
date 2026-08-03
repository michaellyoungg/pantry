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
