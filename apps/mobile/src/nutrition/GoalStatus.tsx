/**
 * How a set of nutrition goals is currently doing (BL-0038), native.
 *
 * Presentation only — every decision about what may be said is made by the pure
 * evaluator and the pure shaping in `@pantry/core`. The one rule this file must
 * not break: an `unknown` goal renders its reason, never a figure. A number
 * beside a cholesterol cap is read as a measurement, and on a health screen an
 * unmeasured zero dressed as a measurement is the worst thing we could show.
 */
import { type GoalTone, goalChips, goalSummary } from "@pantry/core";
import type { NutritionTargetEvaluation } from "@pantry/types";
import { Text, View } from "react-native";
import { surfaceTestIDs, testIDKey, type TestIDSurface } from "../testing/testIDs";

/** The web app's `TONE_CLASS`, in NativeWind. Same tones, same meaning. */
const TONE_CLASS: Record<GoalTone, string> = {
  good: "border-primary/30 bg-primary/10",
  warn: "border-border bg-border/30",
  bad: "border-danger/40 bg-danger/10",
  muted: "border-dashed border-border",
};

const TONE_TEXT: Record<GoalTone, string> = {
  good: "text-primary",
  warn: "text-text",
  bad: "text-danger",
  muted: "text-muted",
};

export function GoalStatus({
  evaluations,
  emptyNote,
  surface,
}: {
  evaluations: readonly NutritionTargetEvaluation[];
  /** Shown instead of the chips when no goal applies here. */
  emptyNote?: string;
  surface: TestIDSurface;
}) {
  const id = surfaceTestIDs(surface);

  if (evaluations.length === 0) {
    return emptyNote ? <Text className="text-xs text-muted">{emptyNote}</Text> : null;
  }

  const summary = goalSummary(evaluations);
  const chips = goalChips(evaluations);

  return (
    <View className="gap-1.5">
      <Text className="text-xs text-muted" testID={id("goal-summary")}>
        {summary.judged > 0 ? (
          <Text className={summary.onTrack ? "text-primary" : "text-muted"}>
            {summary.met} of {summary.judged} goals met
          </Text>
        ) : (
          <Text>Goals can't be checked yet</Text>
        )}
        {summary.unknown > 0 && <Text> · {summary.unknown} can't be checked</Text>}
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        {chips.map((chip) => (
          <View
            className={`flex-row items-baseline gap-1.5 rounded-xl border px-2 py-0.5 ${TONE_CLASS[chip.tone]}`}
            key={chip.key}
            testID={id("goal-chip", testIDKey(chip.key))}
          >
            <Text className={`text-xs font-medium ${TONE_TEXT[chip.tone]}`}>{chip.label}</Text>
            {/* The measurement slot. Separated from the label so "≤ 200 mg" (the
                goal) can never be mistaken for "200 mg" (what you ate) — by a
                reader or by a test. */}
            <Text className={`text-xs opacity-80 ${TONE_TEXT[chip.tone]}`}>{chip.detail}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
