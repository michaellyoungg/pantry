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
 * Derived from the query so `_id` keeps its `Id<"basket">` brand. Named for the
 * screen rather than `PlannedRow`, which `prep.ts` already uses for the much
 * smaller shape its signature reads.
 */
export type WeekPlanRow = FunctionReturnType<typeof api.basket.list>[number];

export type UsePlanWeek = {
  items: WeekPlanRow[];
  /** The seven day buckets, Mon…Sun. */
  days: PlannedDay<WeekPlanRow>[];
  /** Basket rows with no day yet — the "not yet planned" rail. */
  unscheduled: WeekPlanRow[];
  /** True until the first response; distinct from "the basket is empty". */
  loading: boolean;
  generating: boolean;
  error: string | null;
  canGenerate: boolean;
  /** Put a row on a day (0=Mon … 6=Sun), moving it if it was on another. */
  schedule: (row: WeekPlanRow, weekday: number) => void;
  /** Off its day, but still in the basket. */
  unschedule: (row: WeekPlanRow) => void;
  increaseServings: (row: WeekPlanRow) => void;
  decreaseServings: (row: WeekPlanRow) => void;
  toggleType: (row: WeekPlanRow) => void;
  toggleCooked: (row: WeekPlanRow) => void;
  /** Drop the recipe from the basket entirely. */
  remove: (row: WeekPlanRow) => void;
  /** Resolves `true` when the list landed, so the caller can route. */
  buildList: () => Promise<boolean>;
};

/**
 * The week planner's wiring, with no view attached. See `./index.ts`.
 *
 * Actions take a row rather than a recipe id so the dial, the type toggle and
 * the cooked toggle derive their next value here, not in each client's view.
 */
export function usePlanWeek({ generate }: { generate?: GenerateGroceryList } = {}): UsePlanWeek {
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

  // Two slots that cross-clear, so a stale failure never sits beside a fresh
  // success — both are rendered in one place on both clients.
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
    (row: WeekPlanRow, weekday: number) =>
      write(() => schedule({ recipeId: row.recipeId, weekday })),
    [schedule, write],
  );

  const unscheduleRow = useCallback(
    (row: WeekPlanRow) => write(() => unschedule({ recipeId: row.recipeId })),
    [unschedule, write],
  );

  const dialServings = useCallback(
    (row: WeekPlanRow, next: (multiplier: number) => number) =>
      write(() =>
        setServings({ recipeId: row.recipeId, servingsMultiplier: next(servingsMultiplier(row)) }),
      ),
    [setServings, write],
  );

  const increaseServings = useCallback(
    (row: WeekPlanRow) => dialServings(row, increaseMultiplier),
    [dialServings],
  );

  const decreaseServings = useCallback(
    (row: WeekPlanRow) => dialServings(row, decreaseMultiplier),
    [dialServings],
  );

  const toggleType = useCallback(
    (row: WeekPlanRow) => write(() => setType({ recipeId: row.recipeId, type: toggledType(row) })),
    [setType, write],
  );

  const toggleCooked = useCallback(
    (row: WeekPlanRow) =>
      write(() =>
        isCooked(row)
          ? unmarkCooked({ recipeId: row.recipeId })
          : markCooked({ recipeId: row.recipeId }),
      ),
    [markCooked, unmarkCooked, write],
  );

  const remove = useCallback(
    (row: WeekPlanRow) => write(() => removeFromBasket({ recipeId: row.recipeId })),
    [removeFromBasket, write],
  );

  return {
    items,
    days: planWeek(items),
    unscheduled: unscheduledItems(items),
    loading: data === undefined,
    generating,
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
