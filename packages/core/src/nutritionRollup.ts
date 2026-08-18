import type {
  NutritionEstimate,
  NutritionRecipeCoverage,
  NutritionTarget,
  NutritionTargetEvaluation,
} from "@pantry/types";
import {
  NUTRITION_COVERAGE_THRESHOLD,
  type NutrientRow,
  nutrientRows,
  unresolvedItems,
} from "./nutrition";
import { type NutritionFactsRow, nutritionFactsLabel } from "./nutritionFacts";
import { evaluateTargets } from "./nutritionTargets";
import type { PlannedItem } from "./planner";
import { DAY_FULL, DAYS } from "./week";

// The plan rollup (BL-0037): a week of nutrition estimates turned into what a
// client may show. It lives here rather than in a component because the part
// that matters is not the layout — it is the rule about when a number may be
// shown at all, and that rule has to be identical on every client and testable
// without rendering anything.

/** One day's estimate as the rollup action returns it. */
export interface PlanDayNutrition {
  /** 0=Mon … 6=Sun, matching the basket's weekday. */
  weekday: number;
  estimate: NutritionEstimate;
}

/** The whole response: the days that had food, plus one whole-week estimate. */
export interface PlanNutrition {
  days: PlanDayNutrition[];
  /**
   * The week estimated in a single call rather than summed from the days. Its
   * coverage is therefore computed over the whole week's food at once, which is
   * not the same as averaging seven fractions.
   */
  week: NutritionEstimate | null;
}

/**
 * Everything unaccounted for, so a client can say so instead of quietly
 * under-reporting.
 *
 * Two failure modes, deliberately kept apart: a recipe can be *excluded* (we
 * could not read it at all, so none of its food is in the totals and no mass
 * fraction can express its absence), or *partial* (counted, but some of its
 * ingredients did not resolve). Blending them into one percentage is exactly
 * how a day missing a whole dinner comes to look complete.
 */
export interface NutritionGaps {
  /** Recipes whose food is missing from the totals entirely. */
  excludedRecipes: string[];
  /** Recipes that were counted but only partly accounted for. */
  partialRecipes: string[];
  /** Individual ingredients that did not resolve, de-duplicated. */
  missingItems: string[];
  /** True when anything at all is unaccounted for. */
  incomplete: boolean;
}

export type NutritionSummary =
  /** Nothing planned — not the same as "we could not work it out". */
  | { kind: "empty" }
  /** Too little of the food resolved to put a number on screen. */
  | { kind: "unavailable"; coveragePercent: number; gaps: NutritionGaps }
  | {
      kind: "estimate";
      rows: NutrientRow[];
      /** Share of the food we *saw* that resolved. Excluded recipes are not in it. */
      coveragePercent: number;
      gaps: NutritionGaps;
    };

/** The label to use for a recipe the server could not read back. */
const UNNAMED_RECIPE = "a removed recipe";

function recipeLabel(r: NutritionRecipeCoverage): string {
  return r.title?.trim() || UNNAMED_RECIPE;
}

/** A counted recipe is "partial" on the same threshold a whole plan is. */
function isPartial(r: NutritionRecipeCoverage): boolean {
  return (
    r.counted &&
    r.coverage.totalCount > 0 &&
    r.coverage.resolvedMassFraction < NUTRITION_COVERAGE_THRESHOLD
  );
}

function gapsOf(estimate: NutritionEstimate): NutritionGaps {
  const recipes = estimate.recipes ?? [];
  const excludedRecipes = recipes.filter((r) => !r.counted).map(recipeLabel);
  const partialRecipes = recipes.filter(isPartial).map(recipeLabel);
  const missingItems = unresolvedItems(estimate);
  return {
    excludedRecipes,
    partialRecipes,
    missingItems,
    incomplete: excludedRecipes.length > 0 || partialRecipes.length > 0 || missingItems.length > 0,
  };
}

/**
 * What a client may show for one estimate — a recipe, a day, or a week.
 *
 * `null` means nothing was planned. An estimate whose recipes were all
 * unreadable is *not* empty: it has gaps to report, and collapsing it to
 * "nothing planned" would erase the dinner the user actually scheduled.
 */
export function summarizeNutrition(
  estimate: NutritionEstimate | null | undefined,
  divisor = 1,
): NutritionSummary {
  if (!estimate) return { kind: "empty" };

  const recipes = estimate.recipes ?? [];
  if (estimate.coverage.totalCount === 0 && recipes.length === 0) return { kind: "empty" };

  const gaps = gapsOf(estimate);
  const coveragePercent = Math.round(estimate.coverage.resolvedMassFraction * 100);
  const rows = nutrientRows(estimate.nutrients, divisor);

  if (estimate.coverage.resolvedMassFraction < NUTRITION_COVERAGE_THRESHOLD || rows.length === 0) {
    return { kind: "unavailable", coveragePercent, gaps };
  }
  return { kind: "estimate", rows, coveragePercent, gaps };
}

/** One day of the week grid with its nutrition summary attached. */
export interface DayNutritionSummary {
  weekday: number;
  /** Short label, e.g. "Mon". */
  label: string;
  /** Full label, e.g. "Monday". */
  fullLabel: string;
  summary: NutritionSummary;
}

export interface WeekNutritionRollup {
  /** All seven days, Mon…Sun; days with nothing planned summarize as empty. */
  days: DayNutritionSummary[];
  week: NutritionSummary;
  /** How many days actually had food planned — the divisor for the average. */
  plannedDays: number;
  /**
   * The week's figures divided by the days that had food, which is the number
   * the user reasons in ("about 2,200 kcal a day"). Empty when the week's own
   * summary is not showable, so an average can never outlive the total it came
   * from.
   */
  dailyAverage: NutrientRow[];
}

/**
 * A key that changes exactly when the week's nutrition answer would change, so
 * a client can re-ask on a real edit and not on a re-render.
 *
 * `type` is deliberately absent: a leftover is eaten, so flipping meal ↔
 * leftover moves the grocery list and leaves nutrition alone. Unscheduled
 * entries are absent for the same reason — they belong to no day.
 */
export function planNutritionSignature(items: readonly PlannedItem[]): string {
  return items
    .filter((i) => Number.isInteger(i.weekday))
    .map((i) => `${i.weekday}:${i.recipeId}:${i.servingsMultiplier ?? 1}`)
    .sort()
    .join("|");
}

/** Buckets the rollup response into the seven-day grid the planner renders. */
export function rollUpWeekNutrition(data: PlanNutrition): WeekNutritionRollup {
  const byDay = new Map(data.days.map((d) => [d.weekday, d.estimate]));

  const days = DAYS.map((label, weekday) => ({
    weekday,
    label,
    fullLabel: DAY_FULL[weekday],
    summary: summarizeNutrition(byDay.get(weekday)),
  }));

  const week = summarizeNutrition(data.week);
  const plannedDays = days.filter((d) => d.summary.kind !== "empty").length;

  return {
    days,
    week,
    plannedDays,
    dailyAverage:
      week.kind === "estimate" && plannedDays > 0
        ? nutrientRows(data.week?.nutrients, plannedDays)
        : [],
  };
}

/** One planned day's goals, named. */
export interface PlanDayGoals {
  weekday: number;
  /** Full label, e.g. "Monday". */
  label: string;
  evaluations: NutritionTargetEvaluation[];
}

/**
 * How the planned week is doing against the user's goals (BL-0038).
 *
 * It computes no totals of its own. The day and week vectors come from the plan
 * rollup (BL-0037), which is also what guarantees the two surfaces agree: a day
 * the rollup will not put a number on is a day this reports as unchecked,
 * because both consult the same coverage rule.
 *
 * That agreement is the whole point. A day holding a recipe we could not read
 * contributes nothing to the totals, and nothing looks exactly like zero — so
 * without the coverage rule a cholesterol cap would come back "met" on the one
 * day we knew least about.
 */
export interface PlanGoalStatus {
  /** Week-window goals, or `null` when the user has set none. */
  week: NutritionTargetEvaluation[] | null;
  /**
   * Day-window goals, one entry per day the plan has food on, or `null` when
   * the user has set none. Seven rows of "nothing planned" is noise, and an
   * empty day is not a goal you failed.
   */
  days: PlanDayGoals[] | null;
}

function vectorFor(estimate: NutritionEstimate | null | undefined) {
  return estimate ? { nutrients: estimate.nutrients, coverage: estimate.coverage } : null;
}

/**
 * Evaluates the week's goals, or `null` when there is no goal on either window
 * and the surface has nothing to draw.
 */
export function planGoalStatus(
  targets: readonly NutritionTarget[],
  data: PlanNutrition,
): PlanGoalStatus | null {
  const hasDayGoals = targets.some((t) => t.active && t.period === "day");
  const hasWeekGoals = targets.some((t) => t.active && t.period === "week");
  if (!hasDayGoals && !hasWeekGoals) return null;

  return {
    week: hasWeekGoals ? evaluateTargets(targets, vectorFor(data.week), "week") : null,
    days: hasDayGoals
      ? data.days.map((day) => ({
          weekday: day.weekday,
          label: DAY_FULL[day.weekday],
          evaluations: evaluateTargets(targets, vectorFor(day.estimate), "day"),
        }))
      : null,
  };
}

/** One day of the plan, with everything its row and its panel need. */
export interface PlanNutritionDay extends DayNutritionSummary {
  /**
   * The Nutrition Facts rows for this day, empty unless the day's summary is
   * showable. Only a day we would put a number on gets a panel: a
   * quasi-official label over figures the rest of the app has agreed not to
   * trust is the artifact this whole track exists to prevent.
   *
   * A day is the period the Daily Value is defined against, so the day's own
   * total is the figure — no divisor, and no per-serving idea here.
   */
  factsRows: NutritionFactsRow[];
}

/** Everything the plan's nutrition surface renders, decided in one place. */
export interface PlanNutritionView {
  rollup: WeekNutritionRollup;
  /** The days with food on them, in weekday order. */
  days: PlanNutritionDay[];
  goals: PlanGoalStatus | null;
}

/**
 * Reads one rollup response into what a client may draw (BL-0065).
 *
 * The goal status is computed from the same response as the totals, which is
 * what keeps the two halves of the surface from ever disagreeing about whether
 * a day is knowable.
 */
export function planNutritionView(
  data: PlanNutrition,
  targets: readonly NutritionTarget[] = [],
): PlanNutritionView {
  const rollup = rollUpWeekNutrition(data);
  const estimateByDay = new Map(data.days.map((d) => [d.weekday, d.estimate]));

  return {
    rollup,
    days: rollup.days
      .filter((day) => day.summary.kind !== "empty")
      .map((day) => {
        const estimate = estimateByDay.get(day.weekday);
        return {
          ...day,
          factsRows:
            day.summary.kind === "estimate" && estimate
              ? nutritionFactsLabel(estimate.nutrients, { targets, period: "day" })
              : [],
        };
      }),
    goals: planGoalStatus(targets, data),
  };
}
