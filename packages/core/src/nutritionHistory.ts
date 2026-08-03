import type { NutritionLogEntry, NutritionLogSource } from "@pantry/types";
import { type DateRange, datesInRange } from "./calendar";
import { NUTRITION_COVERAGE_THRESHOLD } from "./nutrition";

/**
 * Habit review — turning `nutritionLog` rows into a retrospective (BL-0039).
 *
 * Pure, and deliberately so: the rule that decides whether a day counts is the
 * part of this feature that can quietly lie to the user, so it is tested
 * directly rather than through a chart.
 *
 * The governing rule: **a day we cannot account for is excluded, never counted
 * as zero.** Averaging a missing day in as 0 kcal under-reports every figure on
 * the page, and it under-reports worst exactly when coverage is worst — which is
 * the moment a user is most likely to trust the number and act on it.
 *
 * **Not yet here: goal-met rate.** It needs the `nutritionTargets` table, which
 * is BL-0038's and had not landed when this shipped. Defining a second targets
 * table to unblock it would have been worse than waiting. The seam is already
 * open: `NutrientTrend.points` carries one value per *included* day, so the rate
 * is `points.filter(included && meets(target)).length / includedDays` — and
 * excluded days must stay out of both sides of that fraction, or a week of
 * missing data reads as a week of missed goals.
 */

/**
 * The share of a day's mass that must resolve for the day to count.
 *
 * Aliased to the shared threshold rather than given its own number: a recipe
 * panel refusing to show a figure while that same meal silently counts toward a
 * weekly average would be the app arguing with itself. It keeps a distinct name
 * because the two decisions are distinct — that one governs rendering a single
 * estimate, this one governs entering an average — so they can diverge later
 * without touching the recipe panel.
 */
export const MIN_DAY_COVERAGE = NUTRITION_COVERAGE_THRESHOLD;

/** Why a day contributes nothing to a trend. Never "it was zero". */
export type DayExclusionReason =
  /** Nothing was logged that day — silence is not abstinence. */
  | "no-entries"
  /** Too little of a logged meal resolved to food data to trust its total. */
  | "low-coverage"
  /** A logged meal carried no figure for this nutrient at all. */
  | "nutrient-missing";

/** One day's standing in the window, independent of any single nutrient. */
export interface DaySummary {
  date: string; // YYYY-MM-DD
  entryCount: number;
  /** Servings-weighted meals aside, the *worst* coverage of the day's entries. Null with no entries. */
  minCoverage: number | null;
  included: boolean;
  reason?: DayExclusionReason;
}

/** One day's value for one nutrient, or the reason there isn't one. */
export interface DayPoint {
  date: string;
  /** Null whenever `included` is false. Never 0 as a stand-in for unknown. */
  value: number | null;
  included: boolean;
  reason?: DayExclusionReason;
}

/** Which way a nutrient is drifting across the window. */
export type TrendDirection = "rising" | "falling" | "steady" | "unknown";

export interface NutrientTrend {
  nutrientId: string;
  /** Taken from the logged snapshots; empty when no logged meal reported this nutrient. */
  unit: string;
  points: DayPoint[];
  includedDays: number;
  excludedDays: number;
  /** Mean over *included* days only. Null when no day qualified. */
  average: number | null;
  /** Sum over included days. Null when no day qualified — a total of 0 would be a claim. */
  total: number | null;
  direction: TrendDirection;
}

/**
 * What the numbers actually rest on.
 *
 * Derived from the rows themselves rather than hard-coded, so the surface stops
 * saying "based on your plan" by itself on the day BL-0028 starts writing
 * `cooked` rows. Overclaiming here is the failure this field exists to prevent.
 */
export interface HabitSignal {
  sources: NutritionLogSource[];
  label: string;
  /** Present whenever the signal is weaker than "this is what you ate". */
  caveat?: string;
}

export interface HabitReview {
  window: DateRange;
  signal: HabitSignal;
  days: DaySummary[];
  trends: NutrientTrend[];
  loggedMeals: number;
  includedDays: number;
  excludedDays: number;
}

export interface HabitReviewOptions {
  window: DateRange;
  /** Which nutrients to trend, in display order. Presentation choice, not a data limit. */
  nutrientIds: readonly string[];
  /** Override the coverage floor. Defaults to {@link MIN_DAY_COVERAGE}. */
  minCoverage?: number;
}

/** Groups entries by their calendar date. */
function byDate(entries: readonly NutritionLogEntry[]): Map<string, NutritionLogEntry[]> {
  const map = new Map<string, NutritionLogEntry[]>();
  for (const entry of entries) {
    const day = map.get(entry.date);
    if (day) day.push(entry);
    else map.set(entry.date, [entry]);
  }
  return map;
}

/**
 * Coverage of a single logged meal.
 *
 * A recipe with no ingredient lines resolved nothing, and `resolvedMassFraction`
 * of an empty recipe is meaningless — treat it as uncovered rather than as a
 * perfect 1.
 */
function entryCoverage(entry: NutritionLogEntry): number {
  const { coverage } = entry.snapshot;
  if (coverage.totalCount === 0) return 0;
  return coverage.resolvedMassFraction;
}

/**
 * The day's standing before any nutrient is considered.
 *
 * The weakest meal decides: one unidentifiable dinner makes the day's total an
 * undercount, and averaging an undercount is exactly the failure mode this
 * feature is designed against.
 */
function summariseDay(date: string, entries: NutritionLogEntry[], minCoverage: number): DaySummary {
  if (entries.length === 0) {
    return { date, entryCount: 0, minCoverage: null, included: false, reason: "no-entries" };
  }
  const worst = Math.min(...entries.map(entryCoverage));
  if (worst < minCoverage) {
    return {
      date,
      entryCount: entries.length,
      minCoverage: worst,
      included: false,
      reason: "low-coverage",
    };
  }
  return { date, entryCount: entries.length, minCoverage: worst, included: true };
}

/**
 * One day's amount of one nutrient.
 *
 * Reads the snapshot and never re-estimates: the whole reason `snapshot` exists
 * is that a mapping corrected today must not rewrite what was eaten last month.
 * The snapshot holds one whole recipe yield, so the amount eaten is that scaled
 * by the row's `servings`.
 */
function dayAmount(
  entries: NutritionLogEntry[],
  nutrientId: string,
): { amount: number; unit: string } | null {
  let amount = 0;
  let unit = "";
  for (const entry of entries) {
    const nutrient = entry.snapshot.nutrients[nutrientId];
    // A meal that never reported this nutrient makes the day's sum an
    // undercount of unknown size. Refuse the whole day rather than publish it.
    if (!nutrient) return null;
    amount += nutrient.amount * entry.servings;
    unit ||= nutrient.unit;
  }
  return { amount, unit };
}

/** Relative change between the two halves of the window below which we call it steady. */
const DRIFT_THRESHOLD = 0.1;

/**
 * Compares the first half of the included days with the second.
 *
 * Only included days participate, and each half needs at least two of them: a
 * direction drawn from one day per half is noise wearing a trend's clothes.
 */
function driftDirection(points: DayPoint[]): TrendDirection {
  const values = points.filter((p) => p.included && p.value !== null).map((p) => p.value as number);
  if (values.length < 4) return "unknown";
  const half = Math.floor(values.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(values.slice(0, half));
  const second = mean(values.slice(values.length - half));
  if (first === 0) return second === 0 ? "steady" : "rising";
  const change = (second - first) / Math.abs(first);
  if (change > DRIFT_THRESHOLD) return "rising";
  if (change < -DRIFT_THRESHOLD) return "falling";
  return "steady";
}

function trendFor(
  nutrientId: string,
  days: DaySummary[],
  grouped: Map<string, NutritionLogEntry[]>,
): NutrientTrend {
  let unit = "";
  const points: DayPoint[] = days.map((day) => {
    if (!day.included) {
      return { date: day.date, value: null, included: false, reason: day.reason };
    }
    const summed = dayAmount(grouped.get(day.date) ?? [], nutrientId);
    if (summed === null) {
      return { date: day.date, value: null, included: false, reason: "nutrient-missing" };
    }
    unit ||= summed.unit;
    return { date: day.date, value: summed.amount, included: true };
  });

  const included = points.filter((p) => p.included);
  const total = included.length
    ? included.reduce((sum, p) => sum + (p.value as number), 0)
    : // Null, not 0: "we have no idea" and "you consumed none" are different claims.
      null;

  return {
    nutrientId,
    unit,
    points,
    includedDays: included.length,
    excludedDays: points.length - included.length,
    average: total === null ? null : total / included.length,
    total,
    direction: driftDirection(points),
  };
}

const SIGNAL_LABELS: Record<NutritionLogSource, string> = {
  planned: "your plan",
  cooked: "what you cooked",
  manual: "meals you logged",
};

const SOURCE_ORDER: NutritionLogSource[] = ["cooked", "planned", "manual"];

/** Joins a list into prose: `a`, `a and b`, `a, b and c`. */
function conjoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * States which signal the review is showing.
 *
 * Before BL-0028 the only available signal is *planned* — nothing in the system
 * records what was actually cooked — and saying "what you ate" then would be a
 * lie the user has no way to detect.
 */
export function habitSignal(entries: readonly NutritionLogEntry[]): HabitSignal {
  const present = SOURCE_ORDER.filter((s) => entries.some((e) => e.source === s));
  if (present.length === 0) {
    return { sources: [], label: "Nothing logged yet" };
  }
  const label = `Based on ${conjoin(present.map((s) => SIGNAL_LABELS[s]))}`;
  // Any planned row means part of this is intention rather than consumption.
  const caveat = present.includes("planned")
    ? "Planned meals are what you scheduled, not confirmation you cooked them."
    : undefined;
  return { sources: present, label, caveat };
}

/**
 * Builds the retrospective for a window.
 *
 * Entries outside the window are ignored, so a caller may hand over a wider
 * fetch without filtering first.
 */
export function habitReview(
  entries: readonly NutritionLogEntry[],
  { window, nutrientIds, minCoverage = MIN_DAY_COVERAGE }: HabitReviewOptions,
): HabitReview {
  const dates = datesInRange(window);
  const inWindow = entries.filter((e) => e.date >= window.from && e.date <= window.to);
  const grouped = byDate(inWindow);

  const days = dates.map((date) => summariseDay(date, grouped.get(date) ?? [], minCoverage));
  const trends = nutrientIds.map((id) => trendFor(id, days, grouped));

  return {
    window,
    signal: habitSignal(inWindow),
    days,
    trends,
    loggedMeals: inWindow.length,
    includedDays: days.filter((d) => d.included).length,
    excludedDays: days.filter((d) => !d.included).length,
  };
}

/** Human-readable reason a day was left out, for the "days not counted" panel. */
export function exclusionLabel(reason: DayExclusionReason): string {
  switch (reason) {
    case "no-entries":
      return "nothing logged";
    case "low-coverage":
      return "too little of the meal identified";
    case "nutrient-missing":
      return "no figure for this nutrient";
  }
}
