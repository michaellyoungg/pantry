import { api } from "@pantry/convex/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { removeFromBasketOptimistic } from "../convex/optimistic";
import {
  canGenerateList,
  decreaseServings as decreaseMultiplier,
  increaseServings as increaseMultiplier,
  isCooked,
  type PlannedDay,
  planWeek,
  servingsMultiplier,
  toggledType,
  unscheduledItems,
} from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";
import type { GenerateGroceryList } from "./useHome";

/**
 * A basket row, taken from the query's own return type rather than restated.
 * Hand-writing it would erase the `Id<"basket">` brand on `_id` — the same rule
 * every other screen hook here follows.
 *
 * Structurally a `PlannedItem`, which is what the pure planner helpers take, so
 * a row goes straight into them with no mapping layer.
 */
export type PlannedRow = FunctionReturnType<typeof api.basket.list>[number];

export type UsePlanWeek = {
  /** Every basket row, scheduled or not — what "can I build a list?" is asked of. */
  items: PlannedRow[];
  /** The seven day buckets, Mon…Sun. */
  days: PlannedDay<PlannedRow>[];
  /** Rows in the basket with no day yet — the "not yet planned" rail. */
  unscheduled: PlannedRow[];
  /** True until the first server response — distinct from "the basket is empty". */
  loading: boolean;
  /** True while the grocery list is being built. */
  generating: boolean;
  /** The most recent failed write, already stringified. */
  error: string | null;
  /** Whether there is anything to build a grocery list from. */
  canGenerate: boolean;
  /** Put a row on a day (0=Mon … 6=Sun), moving it if it was on another. */
  schedule: (row: PlannedRow, weekday: number) => void;
  /** Take a row off its day; it stays in the basket, on the rail. */
  unschedule: (row: PlannedRow) => void;
  /** One step up the servings dial. Deliberately unbounded. */
  increaseServings: (row: PlannedRow) => void;
  /** One step down, clamped so a batch can never reach zero. */
  decreaseServings: (row: PlannedRow) => void;
  /** Flip a row between a meal and a leftover. */
  toggleType: (row: PlannedRow) => void;
  /** Mark cooked, or undo that — the pantry's only outflow signal (BL-0028). */
  toggleCooked: (row: PlannedRow) => void;
  /** Drop the recipe from the basket entirely. */
  remove: (row: PlannedRow) => void;
  /**
   * Build the grocery list from the plan. Resolves `true` when it landed, so
   * the caller can route to its own list screen — the hook holds no router.
   */
  buildList: () => Promise<boolean>;
};

/**
 * Everything the week planner needs, with no view attached (BL-0055).
 *
 * The planner is the most write-heavy screen in the app: seven mutations, one
 * action, and a servings dial with a clamp that has to hold identically wherever
 * it is drawn. All of it lives here so the web grid (BL-0018) and the native day
 * pager (BL-0064) are the same week with two renderings — the native design
 * diverges hard from the desktop layout, and that divergence is exactly why the
 * wiring underneath it must not.
 *
 * Every action takes a *row* rather than a recipe id. The mutations are keyed on
 * `recipeId`, but the caller always has the row in hand, and taking it is what
 * lets the dial, the type toggle and the cooked toggle derive their next value
 * here instead of in two view layers — the same reason `usePantry` takes an item
 * for its have → low → out cycle.
 */
export function usePlanWeek({ generate }: { generate?: GenerateGroceryList } = {}): UsePlanWeek {
  // Annotated by the query, not cast: this is the one place a schema drift in
  // `basket` surfaces at compile time rather than as an empty week.
  const data = useQuery(api.basket.list);
  const items = data ?? [];

  const schedule = useMutation(api.basket.schedule);
  const unschedule = useMutation(api.basket.unschedule);
  const setServings = useMutation(api.basket.setServings);
  const setType = useMutation(api.basket.setType);
  const markCooked = useMutation(api.basket.markCooked);
  const unmarkCooked = useMutation(api.basket.unmarkCooked);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const generateList = useAction(api.recipes.generateGroceryList);

  // Two slots, because the two kinds of failure are read differently: a mutation
  // that failed is about one meal, and a generation that failed is about the
  // whole week. They cross-clear below, so the screen never shows a stale one
  // beside a fresh success.
  const { run: runWrite, error: writeError, clearError: clearWriteError } = useAsyncAction();
  const {
    run: runGenerate,
    error: generateError,
    pending: generating,
    clearError: clearGenerateError,
  } = useAsyncAction();

  const write = useCallback(
    (fn: () => Promise<unknown>) => {
      clearGenerateError();
      void runWrite(fn);
    },
    [clearGenerateError, runWrite],
  );

  const build = generate ?? generateList;
  const buildList = useCallback(async () => {
    clearWriteError();
    return (await runGenerate(() => build({}))) !== undefined;
  }, [build, clearWriteError, runGenerate]);

  const scheduleRow = useCallback(
    (row: PlannedRow, weekday: number) =>
      write(() => schedule({ recipeId: row.recipeId, weekday })),
    [schedule, write],
  );

  const unscheduleRow = useCallback(
    (row: PlannedRow) => write(() => unschedule({ recipeId: row.recipeId })),
    [unschedule, write],
  );

  const dialServings = useCallback(
    (row: PlannedRow, next: (multiplier: number) => number) =>
      write(() =>
        setServings({ recipeId: row.recipeId, servingsMultiplier: next(servingsMultiplier(row)) }),
      ),
    [setServings, write],
  );

  const increaseServings = useCallback(
    (row: PlannedRow) => dialServings(row, increaseMultiplier),
    [dialServings],
  );

  const decreaseServings = useCallback(
    (row: PlannedRow) => dialServings(row, decreaseMultiplier),
    [dialServings],
  );

  const toggleType = useCallback(
    (row: PlannedRow) => write(() => setType({ recipeId: row.recipeId, type: toggledType(row) })),
    [setType, write],
  );

  const toggleCooked = useCallback(
    (row: PlannedRow) =>
      write(() =>
        isCooked(row)
          ? unmarkCooked({ recipeId: row.recipeId })
          : markCooked({ recipeId: row.recipeId }),
      ),
    [markCooked, unmarkCooked, write],
  );

  const remove = useCallback(
    (row: PlannedRow) => write(() => removeFromBasket({ recipeId: row.recipeId })),
    [removeFromBasket, write],
  );

  return {
    items,
    days: planWeek(items),
    unscheduled: unscheduledItems(items),
    loading: data === undefined,
    generating,
    // The freshest failure wins: a write clears the generate slot before it runs
    // and vice versa, so at most one of the two is ever set.
    error: generateError ?? writeError,
    canGenerate: canGenerateList(items),
    schedule: scheduleRow,
    unschedule: unscheduleRow,
    increaseServings,
    decreaseServings,
    toggleType,
    toggleCooked,
    remove,
    buildList,
  };
}
