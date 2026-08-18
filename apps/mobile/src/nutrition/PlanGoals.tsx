/**
 * How the planned week is doing against the user's goals (BL-0038), native.
 *
 * It computes nothing: `planGoalStatus` in `@pantry/core` evaluates the days and
 * the week from the same rollup response the figures above come from. That
 * shared origin is what guarantees the two surfaces agree — a day the rollup
 * will not put a number on is a day this reports as unchecked, because both
 * consult one coverage rule.
 *
 * A day holding a recipe we could not read contributes nothing to the totals,
 * and nothing looks exactly like zero. Without that rule a cholesterol cap would
 * come back "met" on the one day we knew least about.
 */
import type { PlanGoalStatus } from "@pantry/core";
import { Text, View } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";
import { GoalStatus } from "./GoalStatus";

const id = surfaceTestIDs("plan");

export function PlanGoals({ goals }: { goals: PlanGoalStatus }) {
  return (
    <View className="gap-3" testID={id("goals")}>
      {goals.week !== null && (
        <View className="gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
            This week's goals
          </Text>
          <GoalStatus evaluations={goals.week} surface="plan" />
        </View>
      )}

      {goals.days !== null && goals.days.length > 0 && (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
            Daily goals
          </Text>
          {/* Only days the plan has food on. Seven rows of "nothing planned" is
              noise, and an empty day is not a goal you failed. */}
          {goals.days.map((day) => (
            <View className="gap-1" key={day.weekday}>
              <Text className="text-xs font-medium text-text">{day.label}</Text>
              <GoalStatus evaluations={day.evaluations} surface="plan" />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
