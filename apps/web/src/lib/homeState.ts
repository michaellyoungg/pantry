// Home answers "what do I do now?" (BL-0017). The answer is derived entirely from
// the week plan and the grocery list — there is no stored "shopping session" state,
// so a non-empty grocery list *is* the signal that the list has been built.

export type BasketRow = {
  _id: string;
  recipeId: string;
  title: string;
  weekday?: number;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
};

export type GroceryRow = {
  _id: string;
  item: string;
  checked: boolean;
};

export type HomeState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "planned"; mealCount: number }
  | { kind: "shopping"; total: number; checked: number; remaining: number }
  | { kind: "shopped"; total: number; mealCount: number };

/** Meals that will actually produce grocery lines — leftovers are excluded server-side. */
export function countMeals(basket: BasketRow[]): number {
  return basket.filter((row) => row.type !== "leftover").length;
}

/**
 * The grocery list is checked before the plan, so clearing the plan mid-shop doesn't
 * yank the shopping-day handoff away from someone standing in a store.
 *
 * Nothing clears the list automatically, so a fully-checked list persists into the
 * next week's planning. `shopped` therefore carries the plan's meal count: it is a
 * terminal-looking state that must still offer a way to build the next list, or Home
 * strands the user for the rest of the week.
 */
export function deriveHomeState(
  basket: BasketRow[] | undefined,
  list: GroceryRow[] | undefined,
): HomeState {
  if (basket === undefined || list === undefined) return { kind: "loading" };

  const mealCount = countMeals(basket);

  if (list.length > 0) {
    const checked = list.filter((row) => row.checked).length;
    if (checked === list.length) return { kind: "shopped", total: list.length, mealCount };
    return { kind: "shopping", total: list.length, checked, remaining: list.length - checked };
  }

  // A plan of nothing but leftovers generates an empty list, so it isn't ready to build.
  if (mealCount > 0) return { kind: "planned", mealCount };

  return { kind: "empty" };
}
