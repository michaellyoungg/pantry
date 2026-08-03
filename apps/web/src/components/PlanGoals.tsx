import { api } from "@pantry/convex/api";
import { DAY_FULL, evaluateTargets } from "@pantry/core";
import type { NutritionEstimate } from "@pantry/types";
import { useQuery } from "convex/react";
import { GoalStatus } from "./GoalStatus";

/**
 * How the planned week is doing against the user's goals (BL-0038).
 *
 * It computes no totals of its own. The day and week vectors come from the plan
 * rollup (BL-0037), which is also what guarantees the two surfaces agree: a day
 * the rollup will not put a number on is a day this component reports as
 * unchecked, because both consult the same coverage rule.
 *
 * That agreement is the whole point. A day holding a recipe we could not read
 * contributes nothing to the totals, and nothing looks exactly like zero — so
 * without the coverage rule a cholesterol cap would come back "met" on the one
 * day we knew least about.
 */

/** One day's rollup, structurally what the rollup action returns. */
export interface PlanGoalDay {
  /** 0=Mon … 6=Sun, matching the basket's weekday. */
  weekday: number;
  estimate: NutritionEstimate;
}

export function PlanGoals({
  days,
  week,
}: {
  days: readonly PlanGoalDay[];
  /** The week estimated in one pass; null when the rollup could not produce one. */
  week: NutritionEstimate | null;
}) {
  const targets = useQuery(api.nutritionTargets.list) ?? [];

  const hasDayGoals = targets.some((t) => t.active && t.period === "day");
  const hasWeekGoals = targets.some((t) => t.active && t.period === "week");
  if (!hasDayGoals && !hasWeekGoals) return null;

  const vectorFor = (estimate: NutritionEstimate | null) =>
    estimate ? { nutrients: estimate.nutrients, coverage: estimate.coverage } : null;

  return (
    <div className="flex flex-col gap-3">
      {hasWeekGoals && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            This week's goals
          </h3>
          <GoalStatus evaluations={evaluateTargets(targets, vectorFor(week), "week")} />
        </div>
      )}

      {hasDayGoals && days.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Daily goals</h3>
          <ul className="flex flex-col gap-2">
            {/* Only days the plan has food on. Seven rows of "nothing planned"
                is noise, and an empty day is not a goal you failed. */}
            {days.map((day) => (
              <li key={day.weekday} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text">{DAY_FULL[day.weekday]}</span>
                <GoalStatus
                  evaluations={evaluateTargets(targets, vectorFor(day.estimate), "day")}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
