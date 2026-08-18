// Home answers "what do I do now?" (BL-0017). The answer is derived entirely from
// the week plan and the grocery list — there is no stored "shopping session" state,
// so a non-empty grocery list *is* the signal that the list has been built.
//
// This lives in `@pantry/core` rather than in a client (BL-0062) because both the
// web dashboard and the native launch screen answer that question, and a state
// machine authored twice is a state machine that disagrees with itself.

import { type CartLine, partitionCart, partitionRemoved, type RemovableLine } from "./grocery";
import { isLeftover, type PlannedItem } from "./planner";

/**
 * A grocery line as Home cares about it — whether it is in the cart, and
 * whether the plan still wants it. Nothing else about a line changes the
 * answer, so nothing else is required of the caller's rows.
 */
export type HomeGroceryLine = CartLine & RemovableLine;

export type HomeState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "planned"; mealCount: number }
  | { kind: "shopping"; total: number; checked: number; remaining: number }
  | { kind: "shopped"; total: number; mealCount: number };

/** Meals that will actually produce grocery lines — leftovers are excluded server-side. */
export function countMeals(basket: readonly PlannedItem[]): number {
  return basket.filter((row) => !isLeftover(row)).length;
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
  basket: readonly PlannedItem[] | undefined,
  list: readonly HomeGroceryLine[] | undefined,
): HomeState {
  if (basket === undefined || list === undefined) return { kind: "loading" };

  const mealCount = countMeals(basket);

  // Lines the plan has dropped (BL-0018) are history, not shopping: they were
  // already checked off before regeneration flagged them, so counting them
  // would both inflate "23 items ready" and make the trip look further along
  // than it is. They stay visible on /list, where they can be dismissed.
  const { active } = partitionRemoved(list);

  if (active.length > 0) {
    const { inCart } = partitionCart(active);
    if (inCart.length === active.length) {
      return { kind: "shopped", total: active.length, mealCount };
    }
    return {
      kind: "shopping",
      total: active.length,
      checked: inCart.length,
      remaining: active.length - inCart.length,
    };
  }

  // A plan of nothing but leftovers generates an empty list, so it isn't ready to build.
  if (mealCount > 0) return { kind: "planned", mealCount };

  return { kind: "empty" };
}
