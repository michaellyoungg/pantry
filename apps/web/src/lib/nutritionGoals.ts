import { nutrientMeta } from "@pantry/core";
import type {
  NutritionTarget,
  NutritionTargetEvaluation,
  NutritionTargetStatus,
} from "@pantry/types";
import { formatAmount } from "./nutrition";

/**
 * Turning goal evaluations into something a screen can show (BL-0038).
 *
 * Pure, so the rules that decide what a user is told about their own health
 * data are tested directly rather than through the DOM. The evaluation itself
 * lives in `@pantry/core`; this is only how it reads.
 */

const OPERATOR_SYMBOL: Record<NutritionTarget["operator"], string> = {
  ">=": "≥",
  "<=": "≤",
  // Not "=": the underlying figure is an estimate of as-purchased ingredients,
  // so promising equality would be a claim we cannot make.
  "==": "≈",
};

/** "Protein ≥ 150 g", prefixed with the user's own name for the goal if any. */
export function goalLabel(target: NutritionTarget): string {
  const meta = nutrientMeta(target.nutrientId);
  const name = meta?.label ?? `Nutrient ${target.nutrientId}`;
  const unit = meta ? ` ${meta.unit}` : "";
  const rule = `${name} ${OPERATOR_SYMBOL[target.operator]} ${target.value}${unit}`;
  return target.label ? `${target.label}: ${rule}` : rule;
}

/** How a status should read on screen. */
export type GoalTone = "good" | "warn" | "bad" | "muted";

export interface GoalChip {
  key: string;
  label: string;
  /** The measured amount, or why there isn't one. Never a number when unknown. */
  detail: string;
  status: NutritionTargetStatus;
  tone: GoalTone;
}

/**
 * Exceeding a cap is a different kind of event from not yet reaching a floor.
 * Being under your protein goal on a Tuesday is the ordinary state of a week in
 * progress; being over a cholesterol limit is the thing the user set the goal to
 * avoid. Colouring both as errors would make the screen cry wolf.
 */
function toneFor(status: NutritionTargetStatus, operator: NutritionTarget["operator"]): GoalTone {
  if (status === "met") return "good";
  if (status === "unknown") return "muted";
  if (status === "over" && operator === "<=") return "bad";
  return "warn";
}

function unknownDetail(evaluation: NutritionTargetEvaluation): string {
  switch (evaluation.reason) {
    case "low-coverage": {
      const percent = Math.round((evaluation.coverage ?? 0) * 100);
      return `only ${percent}% identified`;
    }
    case "nutrient-missing":
      return "not measured for this food";
    default:
      return "no estimate yet";
  }
}

/**
 * One chip per goal.
 *
 * An `unknown` chip never carries a number. That is the point of the status: a
 * day whose ingredients we could not identify must not show "12 mg" next to a
 * cholesterol cap, because the reader would take the tick at face value.
 */
export function goalChips(evaluations: readonly NutritionTargetEvaluation[]): GoalChip[] {
  return evaluations.map((e) => ({
    key: `${e.target.nutrientId}:${e.target.period}`,
    label: goalLabel(e.target),
    detail:
      e.status === "unknown" || e.actual === null
        ? unknownDetail(e)
        : formatAmount({ nutrientId: e.target.nutrientId, amount: e.actual, unit: e.unit ?? "" }),
    status: e.status,
    tone: toneFor(e.status, e.target.operator),
  }));
}

export interface GoalSummary {
  /** Goals met, out of `judged`. */
  met: number;
  /** How many goals we could actually evaluate. */
  judged: number;
  /** How many we could not, which is never the same as "missed". */
  unknown: number;
  /** True only when every goal was judged and every one was met. */
  onTrack: boolean;
}

/**
 * A headline for a set of goals.
 *
 * Unknowns are counted separately rather than folded into the denominator:
 * "1 of 3" when two were unmeasurable overstates the failure, and "3 of 3" would
 * understate it. And nothing is ever "on track" while a goal is unknown —
 * silence is not a pass.
 */
export function goalSummary(evaluations: readonly NutritionTargetEvaluation[]): GoalSummary {
  const unknown = evaluations.filter((e) => e.status === "unknown").length;
  const judged = evaluations.length - unknown;
  const met = evaluations.filter((e) => e.status === "met").length;
  return { met, judged, unknown, onTrack: judged > 0 && unknown === 0 && met === judged };
}
