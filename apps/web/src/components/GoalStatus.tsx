import type { NutritionTargetEvaluation } from "@pantry/types";
import { type GoalTone, goalChips, goalSummary } from "../lib/nutritionGoals";

/**
 * How a set of nutrition goals is currently doing (BL-0038).
 *
 * Presentation only — every decision about what may be said is made by the pure
 * evaluator in `@pantry/core` and the pure shaping in `lib/nutritionGoals`. The
 * one rule this file must not break: an `unknown` goal renders its reason, never
 * a figure. A number beside a cholesterol cap is read as a measurement, and on a
 * health screen an unmeasured zero dressed as a measurement is the worst thing
 * we could show.
 */

const TONE_CLASS: Record<GoalTone, string> = {
  good: "border-primary/30 bg-primary/10 text-primary",
  warn: "border-border bg-border/30 text-text",
  bad: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-dashed border-border bg-transparent text-muted",
};

export function GoalStatus({
  evaluations,
  emptyNote,
}: {
  evaluations: readonly NutritionTargetEvaluation[];
  /** Shown instead of the chips when no goal applies here. */
  emptyNote?: string;
}) {
  if (evaluations.length === 0) {
    return emptyNote ? <p className="text-xs text-muted">{emptyNote}</p> : null;
  }

  const summary = goalSummary(evaluations);
  const chips = goalChips(evaluations);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted">
        {summary.judged > 0 ? (
          <span className={summary.onTrack ? "text-primary" : undefined}>
            {summary.met} of {summary.judged} goals met
          </span>
        ) : (
          <span>Goals can't be checked yet</span>
        )}
        {summary.unknown > 0 && <span> · {summary.unknown} can't be checked</span>}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip.key}
            data-tone={chip.tone}
            data-status={chip.status}
            className={`flex items-baseline gap-1.5 rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[chip.tone]}`}
          >
            <span className="font-medium">{chip.label}</span>
            {/* The measurement slot. Separated from the label so "≤ 200 mg" (the
                goal) can never be mistaken for "200 mg" (what you ate) — by a
                reader or by a test. */}
            <span data-goal-detail className="opacity-80">
              {chip.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
