import { api } from "@pantry/convex/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import { deriveHomeState, type HomeState } from "../home";
import { type PlannedDay, planWeek, unscheduledItems } from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";

/**
 * A planned meal, taken from the query's own return type rather than restated
 * — the same rule the other screen hooks follow, so `_id` keeps its brand.
 */
export type HomeMeal = FunctionReturnType<typeof api.basket.list>[number];

/**
 * `recipes.generateGroceryList`, as Home calls it.
 *
 * Injectable because instrumentation is a per-platform concern: `apps/web`
 * passes its traced wrapper (BL-0027), so a build started from Home still
 * carries a span into Convex and on into the Go service, while `apps/mobile`
 * has no tracer yet and takes the plain action below. Everything else about
 * the call — when it runs, what it does with the result — is shared.
 */
export type GenerateGroceryList = (
  args: FunctionArgs<typeof api.recipes.generateGroceryList>,
) => Promise<FunctionReturnType<typeof api.recipes.generateGroceryList>>;

export type UseHome = {
  /** Which of the five weekly-loop states the account is in. */
  state: HomeState;
  /** The seven day buckets of the week strip, Mon…Sun. */
  days: PlannedDay<HomeMeal>[];
  /**
   * Planned entries with no day yet. They appear in no day cell but still count
   * toward "N meals ready", so a view that shows one must account for the other.
   */
  unscheduled: number;
  /** True while the list is being generated. */
  pending: boolean;
  /** A failed generation, already stringified. */
  error: string | null;
  /**
   * Generate the grocery list from the plan. Resolves `true` when it landed, so
   * the caller can route to its own list screen — the hook holds no router.
   */
  buildList: () => Promise<boolean>;
};

/**
 * Everything the Home dashboard needs, with no view attached (BL-0055).
 *
 * Home is read-and-route: it shows where the weekly loop stands and offers
 * exactly one next action. Which action that is comes from `deriveHomeState`
 * in `@pantry/core`, and the two subscriptions it derives from live here — so
 * the web dashboard (BL-0017) and the native launch screen (BL-0062) are the
 * same state with two renderings.
 */
export function useHome({ generate }: { generate?: GenerateGroceryList } = {}): UseHome {
  // Annotated by the query, not cast: this is the one place a schema drift in
  // basket/groceryList would surface at compile time.
  const basket = useQuery(api.basket.list);
  const list = useQuery(api.groceryList.getGroceryList);
  const generateList = useAction(api.recipes.generateGroceryList);
  const { run, pending, error } = useAsyncAction();

  const build = generate ?? generateList;
  // Building the list from Home saves a hop through the planner on the most
  // common weekly action.
  const buildList = useCallback(
    async () => (await run(() => build({}))) !== undefined,
    [run, build],
  );

  const meals = basket ?? [];

  return {
    state: deriveHomeState(basket, list),
    days: planWeek(meals),
    unscheduled: unscheduledItems(meals).length,
    pending,
    error,
    buildList,
  };
}
