import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import type { PrepMeal } from "@pantry/types";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { doneSet, type PlannedRow, prepPlanSignature, toISODate, weekStartISO } from "./prep";

/**
 * The planned week's derived prep, plus check-off (BL-0042).
 *
 * Two sources on purpose. The tasks come from an ACTION — deriving them needs a
 * network call to recipe-service, which Convex queries physically cannot make —
 * while the ticks come from a reactive QUERY, so checking a box updates
 * instantly instead of re-deriving the whole week over the wire.
 *
 * Shared by Home and the planner so both agree on what is due, and so the two
 * surfaces cannot drift into disagreeing about the same week.
 */
export function usePlanPrep(now: Date = new Date()) {
  const today = toISODate(now);
  const weekStart = weekStartISO(now);

  const forPlan = useTracedAction(api.prepTasks.forPlan, "prepTasks.forPlan");
  const setDoneMutation = useMutation(api.prepTasks.setDone);
  const states = useQuery(api.prepTasks.states) ?? [];
  // The plan itself, only to know when to re-derive. Convex dedupes identical
  // queries, so subscribing here costs nothing on surfaces that already read it.
  const plan: PlannedRow[] = useQuery(api.basket.list) ?? [];

  const load = useCallback(() => forPlan({ weekStart, today }), [forPlan, weekStart, today]);
  // Re-ask when the week actually changes. Deriving once on mount would leave
  // the badge lying about a meal the user just scheduled.
  const { data, loading, error } = useAsyncData(load, [prepPlanSignature(plan)]);

  const meals: PrepMeal[] = data?.meals ?? [];
  const done = useMemo(() => doneSet(states), [states]);

  const setDone = useCallback(
    (taskKey: string, cookDate: string, value: boolean) =>
      setDoneMutation({ taskKey, cookDate, done: value }),
    [setDoneMutation],
  );

  return { meals, today, done, setDone, loading, error };
}
