import { DAY_FULL, DAYS } from "./week";

// The week plan's domain layer (BL-0018): which basket entry sits on which day,
// what the unscheduled rail holds, and how the servings dial moves. Rendering
// lives in the client; everything a second client would otherwise reimplement
// lives here.

/** A basket entry as the planner cares about it — a row with an optional slot. */
export type PlannedItem = {
  _id: string;
  recipeId: string;
  title: string;
  /** 0=Mon … 6=Sun. Absent while the entry waits on the unscheduled rail. */
  weekday?: number;
  servingsMultiplier?: number;
  type?: "meal" | "leftover";
  /** When this meal was marked cooked (BL-0028). Absent until it is. */
  cookedAt?: number;
};

/** One day of the week grid, with the entries scheduled onto it. */
export type PlannedDay<T extends PlannedItem = PlannedItem> = {
  weekday: number;
  /** Short label, e.g. "Mon". */
  label: string;
  /** Full label, e.g. "Monday". */
  fullLabel: string;
  items: T[];
};

/** Servings can be dialled in half-batches; a quarter batch is the floor. */
export const SERVINGS_STEP = 0.5;
export const MIN_SERVINGS_MULTIPLIER = 0.25;

/** The seven day buckets, Mon…Sun, each holding the entries scheduled onto it. */
export function planWeek<T extends PlannedItem>(items: readonly T[]): PlannedDay<T>[] {
  return DAYS.map((label, weekday) => ({
    weekday,
    label,
    fullLabel: DAY_FULL[weekday],
    items: items.filter((i) => i.weekday === weekday),
  }));
}

/** Entries waiting on the rail — in the basket, not yet placed on a day. */
export function unscheduledItems<T extends PlannedItem>(items: readonly T[]): T[] {
  return items.filter((i) => i.weekday == null);
}

/** An entry's servings dial; unset means a single batch. */
export function servingsMultiplier(item: PlannedItem): number {
  return item.servingsMultiplier ?? 1;
}

/** One step down, clamped so a batch can never reach zero (or go negative). */
export function decreaseServings(multiplier: number): number {
  return Math.max(MIN_SERVINGS_MULTIPLIER, multiplier - SERVINGS_STEP);
}

/** One step up. Deliberately unbounded — cooking for a crowd is legitimate. */
export function increaseServings(multiplier: number): number {
  return multiplier + SERVINGS_STEP;
}

/** Leftovers are eaten, not shopped for, so they produce no grocery lines. */
export function isLeftover(item: PlannedItem): boolean {
  return item.type === "leftover";
}

/**
 * Whether this meal has been cooked (BL-0028). The timestamp's presence is the
 * whole state — marking is idempotent server-side, so the client never has to
 * reason about how many times it was pressed.
 */
export function isCooked(item: PlannedItem): boolean {
  return item.cookedAt !== undefined;
}

/** What the meal/leftover toggle should switch this entry to. */
export function toggledType(item: PlannedItem): "meal" | "leftover" {
  return isLeftover(item) ? "meal" : "leftover";
}

/** A grocery list can only be generated from a non-empty basket. */
export function canGenerateList(items: readonly PlannedItem[]): boolean {
  return items.length > 0;
}

/**
 * The servings dial a recipe should start on for this household (BL-0018), or
 * `undefined` when there is no basis to derive one.
 *
 * The multiplier scales ingredient quantities, so "default from household size"
 * is a ratio, not the household size itself: a 4-serving recipe for a household
 * of 4 is one batch, not four. Both inputs are routinely unknown — household
 * size is optional, and BL-0035 made a recipe's yield nullable precisely
 * because most recipes don't state one. Returning `undefined` there rather than
 * 1 keeps "nobody scaled this" distinct from "this was scaled to 1", and it is
 * already how the planner spells a single batch: an unset dial reads as 1.
 *
 * The result is snapped to the grid the stepper moves on, so the number the
 * planner shows is one the − / + buttons can actually return to.
 */
export function defaultServingsMultiplier(
  householdSize: number | undefined,
  recipeServings: number | undefined,
): number | undefined {
  if (!householdSize || !recipeServings || householdSize <= 0 || recipeServings <= 0) {
    return undefined;
  }
  const snapped = Math.round(householdSize / recipeServings / SERVINGS_STEP) * SERVINGS_STEP;
  return Math.max(MIN_SERVINGS_MULTIPLIER, snapped);
}
