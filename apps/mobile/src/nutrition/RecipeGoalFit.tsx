/**
 * "Fits your goals" for one recipe (BL-0038), native.
 *
 * The verdict is `recipeGoalFit` in `@pantry/core`: the `meal` period judged
 * against the estimate's **per-serving** vector, because a pot holding 160 mg of
 * cholesterol that serves four is a 40 mg meal. A recipe with no yield gets no
 * verdict at all — BL-0035 leaves `servings` optional and the server omits
 * `perServing` rather than dividing by a guess, so treating "serves unknown" as
 * "serves one" would re-introduce the guess where it does the most damage.
 *
 * What is left here is the paint.
 */
import { type GoalFit, GOAL_VERDICT_LABELS, type GoalVerdict } from "@pantry/core";
import { Text, View } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";
import { GoalStatus } from "./GoalStatus";

const id = surfaceTestIDs("recipes");

const VERDICT_CLASS: Record<GoalVerdict, string> = {
  fits: "text-primary",
  unknown: "text-muted",
  misses: "text-danger",
};

export function RecipeGoalFit({ fit }: { fit: GoalFit }) {
  if (fit.kind === "no-goals") return null;

  if (fit.kind === "no-servings") {
    return (
      <Text className="text-xs text-muted" testID={id("goal-fit-no-servings")}>
        Add a serving count to this recipe to check it against your per-meal goals.
      </Text>
    );
  }

  return (
    <View className="gap-1.5 py-1" testID={id("goal-fit")}>
      <Text
        className={`text-sm font-medium ${VERDICT_CLASS[fit.verdict]}`}
        testID={id("goal-verdict")}
      >
        {GOAL_VERDICT_LABELS[fit.verdict]}
      </Text>
      <GoalStatus evaluations={fit.evaluations} surface="recipes" />
    </View>
  );
}
