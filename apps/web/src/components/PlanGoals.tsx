import type { PlanGoalStatus } from "@pantry/core";
import { GoalStatus } from "./GoalStatus";

/**
 * How the planned week is doing against the user's goals (BL-0038).
 *
 * It computes no totals of its own, and since BL-0065 it evaluates none either:
 * `planGoalStatus` in `@pantry/core` does that from the same rollup response
 * (BL-0037) the figures above it come from. That shared origin is what
 * guarantees the two surfaces agree — a day the rollup will not put a number on
 * is a day this reports as unchecked, because both consult one coverage rule.
 *
 * That agreement is the whole point. A day holding a recipe we could not read
 * contributes nothing to the totals, and nothing looks exactly like zero — so
 * without the coverage rule a cholesterol cap would come back "met" on the one
 * day we knew least about.
 */
export function PlanGoals({ goals }: { goals: PlanGoalStatus }) {
  return (
    <div className="flex flex-col gap-3">
      {goals.week !== null && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            This week's goals
          </h3>
          <GoalStatus evaluations={goals.week} />
        </div>
      )}

      {goals.days !== null && goals.days.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Daily goals</h3>
          <ul className="flex flex-col gap-2">
            {/* Only days the plan has food on. Seven rows of "nothing planned"
                is noise, and an empty day is not a goal you failed. */}
            {goals.days.map((day) => (
              <li key={day.weekday} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text">{day.label}</span>
                <GoalStatus evaluations={day.evaluations} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
