import { api } from "@pantry/convex/api";
import type { PrepMeal } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { startOfWeek, toISODate } from "../calendar";
import { setPrepTaskDoneOptimistic } from "../convex/optimistic";
import { doneSet, type PlannedRow, prepPlanSignature } from "../prep";
import { useAsyncData } from "../react/useAsyncData";

/**
 * `prepTasks.forPlan`, as the surfaces call it.
 *
 * Injectable for the same reason `useHome`'s generate is: instrumentation is a
 * per-platform concern. `apps/web` passes its traced wrapper (BL-0027) so a
 * derivation started from Home carries a span into Convex and on into the Go
 * service; `apps/mobile` has no tracer yet and takes the plain action below.
 */
export type PrepForPlan = (
  args: FunctionArgs<typeof api.prepTasks.forPlan>,
) => Promise<FunctionReturnType<typeof api.prepTasks.forPlan>>;

export type UsePlanPrep = {
  /** The planned week's derived prep, one entry per scheduled meal. */
  meals: PrepMeal[];
  /** The user's local date the week was derived against. */
  today: string;
  /** Ticked tasks, keyed by `stateKey(taskKey, cookDate)`. */
  done: Set<string>;
  /** Tick or untick one task for one meal date. Optimistic. */
  setDone: (taskKey: string, cookDate: string, value: boolean) => Promise<void>;
  /** True until the first derivation answers. */
  loading: boolean;
  /** A failed derivation, already stringified. */
  error: string | null;
};

/**
 * The planned week's derived prep, plus check-off (BL-0042), headless (BL-0055).
 *
 * Two sources on purpose. The tasks come from an ACTION — deriving them needs a
 * network call to recipe-service, which Convex queries physically cannot make —
 * while the ticks come from a reactive QUERY, so checking a box updates
 * instantly instead of re-deriving the whole week over the wire.
 *
 * Shared by every surface that shows what is due: web's Home card and planner
 * badges, and the native "before you cook" card (BL-0061). One hook, so they
 * cannot drift into disagreeing about the same week.
 */
export function usePlanPrep({
  forPlan,
  now = new Date(),
}: {
  forPlan?: PrepForPlan;
  now?: Date;
} = {}): UsePlanPrep {
  const today = toISODate(now);
  const weekStart = startOfWeek(today);

  const forPlanAction = useAction(api.prepTasks.forPlan);
  const derive = forPlan ?? forPlanAction;
  // Optimistic: the box is a controlled input, so without this a tap cannot
  // change it until the mutation round-trips and the tap appears to do nothing.
  const setDoneMutation = useMutation(api.prepTasks.setDone).withOptimisticUpdate(
    setPrepTaskDoneOptimistic,
  );
  const states = useQuery(api.prepTasks.states) ?? [];
  // The plan itself, only to know when to re-derive. Convex dedupes identical
  // queries, so subscribing here costs nothing on surfaces that already read it.
  const plan: PlannedRow[] = useQuery(api.basket.list) ?? [];

  const load = useCallback(() => derive({ weekStart, today }), [derive, weekStart, today]);
  // Re-ask when the week actually changes. Deriving once on mount would leave
  // the badge lying about a meal the user just scheduled.
  const { data, loading, error } = useAsyncData(load, [prepPlanSignature(plan)]);

  const meals: PrepMeal[] = data?.meals ?? [];
  const done = useMemo(() => doneSet(states), [states]);

  const setDone = useCallback(
    async (taskKey: string, cookDate: string, value: boolean) => {
      await setDoneMutation({ taskKey, cookDate, done: value });
    },
    [setDoneMutation],
  );

  return { meals, today, done, setDone, loading, error };
}
