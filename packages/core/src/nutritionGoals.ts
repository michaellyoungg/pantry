import type {
  NutritionTarget,
  NutritionTargetEvaluation,
  NutritionTargetPeriod,
  NutritionTargetStatus,
  RecommendationUnverifiedConstraint,
} from "@pantry/types";
import { formatNutrientAmount, nutrientMeta } from "./nutrition";

/**
 * Turning goal evaluations into something a screen can show (BL-0038).
 *
 * Pure, so the rules that decide what a user is told about their own health
 * data are tested directly rather than through the DOM. The evaluation itself
 * lives in `nutritionTargets.ts`; this is only how it reads.
 *
 * Lived in `apps/web/src/lib` until BL-0065 gave the native client the same
 * surfaces. Every word a user reads about their own goals is here rather than
 * in either view, so the two clients cannot describe one evaluation differently.
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
        : formatNutrientAmount({
            nutrientId: e.target.nutrientId,
            amount: e.actual,
            unit: e.unit ?? "",
          }),
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

/**
 * The three things a set of goals can say about one thing you might eat.
 *
 * `unknown` is a verdict, not a missing one. A recipe with one met goal and one
 * we could not measure is not a fit — calling it one would let the nutrient we
 * failed to measure pass as within limits.
 */
export type GoalVerdict = "fits" | "unknown" | "misses";

/** What each verdict says out loud. One wording, both clients. */
export const GOAL_VERDICT_LABELS: Record<GoalVerdict, string> = {
  fits: "Fits your goals",
  unknown: "Can't tell if this fits",
  misses: "Doesn't fit your goals",
};

/** Reads a summary as a single verdict. */
export function goalVerdict(summary: GoalSummary): GoalVerdict {
  if (summary.onTrack) return "fits";
  return summary.unknown > 0 ? "unknown" : "misses";
}

/**
 * The windows a goal can be written against, in editor order, with both the
 * word the picker shows ("day") and the heading a group of them gets
 * ("Per day"). Shared because the editor exists on both clients and the two
 * must not offer different windows.
 */
export const GOAL_PERIODS: ReadonlyArray<{
  value: NutritionTargetPeriod;
  label: string;
  heading: string;
}> = [
  { value: "day", label: "day", heading: "Per day" },
  { value: "week", label: "week", heading: "Per week" },
  { value: "meal", label: "meal", heading: "Per meal" },
];

/** The comparisons a goal can make, worded rather than symbolic. */
export const GOAL_OPERATORS: ReadonlyArray<{
  value: NutritionTarget["operator"];
  label: string;
}> = [
  { value: ">=", label: "at least" },
  { value: "<=", label: "at most" },
  { value: "==", label: "about" },
];

/**
 * The typed amount as a number the mutation will accept, or `null`.
 *
 * A goal with no number is not a goal, and `Number("")` is 0 — which would
 * store "at most 0 mg of sodium" for someone who tabbed past the field. The
 * check is here rather than in either editor so both refuse the same inputs,
 * and so the server's own `assertValue` is never the first thing to notice.
 */
export function parseGoalValue(value: string): number | null {
  if (value.trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

/**
 * Names a hard constraint a recommendation could not be checked against
 * (BL-0040).
 *
 * The service sends a nutrient id rather than a rendered string because only the
 * client holds the nutrient catalog, so the fallback chain matters: the user's
 * own label for the goal, then the catalog's name, then the bare id. It never
 * degrades to silence — an unchecked constraint that renders as nothing reads
 * exactly like one that passed.
 */
export function unverifiedLabel(constraint: RecommendationUnverifiedConstraint): string {
  return (
    constraint.label ??
    nutrientMeta(constraint.nutrientId)?.label ??
    `Nutrient ${constraint.nutrientId}`
  );
}

/**
 * How many active goals are hard constraints — i.e. how many are removing
 * recipes from the suggestions rather than merely reordering them.
 *
 * Worth saying out loud on screen: a filter that silently shrinks a list is
 * indistinguishable from having nothing to suggest.
 */
export function hardConstraintCount(targets: readonly NutritionTarget[]): number {
  return targets.filter((t) => t.active && t.hard === true).length;
}
