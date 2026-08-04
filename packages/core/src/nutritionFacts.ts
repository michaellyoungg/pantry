import type { NutrientAmount, NutritionTarget, NutritionTargetPeriod } from "@pantry/types";

/**
 * The Nutrition Facts panel (BL-0049), as data and arithmetic.
 *
 * This file adds no estimation. It re-presents the vectors BL-0036 produces in
 * the layout every American reader already knows how to parse: a fixed row
 * order, hanging indents, and a right-hand column saying what share of a day the
 * figure costs. That literacy is free to us and the bare label/value grid was
 * declining it — `Sodium 890 mg` means nothing until you happen to know that a
 * day is 2,300 mg.
 *
 * Everything here is pure and unit-tested directly, because the percentage
 * arithmetic is exactly the part that must never be exercised only through the
 * DOM.
 */

/** A reference amount, with the unit it is stated in. */
export interface DailyValue {
  amount: number;
  unit: string;
}

/**
 * The FDA 2016 adult Daily Values, keyed by the FDC nutrient ids already in use
 * elsewhere in the system.
 *
 * Calories, trans fat, total sugars and protein are absent, and their absence is
 * the whole mechanism: those lines carry no %DV on a real label either, so the
 * builder needs no per-nutrient branch to reproduce that — it just finds nothing
 * here and emits `dvPercent: null`. Adding a Daily Value is a one-line data edit.
 */
export const DAILY_VALUES: Readonly<Record<string, DailyValue>> = {
  "1004": { amount: 78, unit: "g" }, // Total fat
  "1258": { amount: 20, unit: "g" }, // Saturated fat
  "1253": { amount: 300, unit: "mg" }, // Cholesterol
  "1093": { amount: 2300, unit: "mg" }, // Sodium
  "1005": { amount: 275, unit: "g" }, // Total carbohydrate
  "1079": { amount: 28, unit: "g" }, // Dietary fiber
  "1235": { amount: 50, unit: "g" }, // Added sugars
  "1114": { amount: 20, unit: "µg" }, // Vitamin D
  "1087": { amount: 1300, unit: "mg" }, // Calcium
  "1089": { amount: 18, unit: "mg" }, // Iron
  "1092": { amount: 4700, unit: "mg" }, // Potassium
};

/**
 * Where a row sits in the panel's visual grouping.
 *
 * `calories` is the oversized line under the top rule; `nutrient` is the macro
 * block; `micronutrient` is the vitamin-and-mineral block below the heavy rule.
 * The component draws the rules from this rather than from row indices, so
 * inserting a nutrient never silently moves a divider.
 */
export type NutritionFactsGroup = "calories" | "nutrient" | "micronutrient";

interface RowSpec {
  id: string;
  label: string;
  /** 0 = flush left, 1 = a component of the line above, 2 = a component of that. */
  indent: 0 | 1 | 2;
  group: NutritionFactsGroup;
}

/**
 * Every row the panel prints, in the FDA's order, always.
 *
 * This is a static table and not a projection of the vector on purpose. A recipe
 * missing four nutrients must yield a panel of exactly the same shape as one
 * missing none — a layout that reflows recipe to recipe is the specific way a
 * label stops reading as a label. Rows we cannot fill print an em-dash (see
 * `NutritionFactsRow.amount`), which is also why they must not be dropped:
 * printing `0` for an unmeasured nutrient would be a lie, and on a panel that
 * looks quasi-official it is the most damaging lie available to us.
 */
const ROWS: readonly RowSpec[] = [
  { id: "1008", label: "Calories", indent: 0, group: "calories" },
  { id: "1004", label: "Total fat", indent: 0, group: "nutrient" },
  { id: "1258", label: "Saturated fat", indent: 1, group: "nutrient" },
  { id: "1257", label: "Trans fat", indent: 1, group: "nutrient" },
  { id: "1253", label: "Cholesterol", indent: 0, group: "nutrient" },
  { id: "1093", label: "Sodium", indent: 0, group: "nutrient" },
  { id: "1005", label: "Total carbohydrate", indent: 0, group: "nutrient" },
  { id: "1079", label: "Dietary fiber", indent: 1, group: "nutrient" },
  { id: "2000", label: "Total sugars", indent: 1, group: "nutrient" },
  { id: "1235", label: "Added sugars", indent: 2, group: "nutrient" },
  { id: "1003", label: "Protein", indent: 0, group: "nutrient" },
  { id: "1114", label: "Vitamin D", indent: 0, group: "micronutrient" },
  { id: "1087", label: "Calcium", indent: 0, group: "micronutrient" },
  { id: "1089", label: "Iron", indent: 0, group: "micronutrient" },
  { id: "1092", label: "Potassium", indent: 0, group: "micronutrient" },
];

/** One printed line of the panel. */
export interface NutritionFactsRow {
  /** FDC nutrient id, e.g. "1093" for sodium. */
  id: string;
  label: string;
  indent: 0 | 1 | 2;
  group: NutritionFactsGroup;
  /**
   * The amount for this period, already divided. `null` means *not estimated* —
   * never zero. A food matched without a cholesterol figure is not a food with
   * no cholesterol.
   */
  amount: NutrientAmount | null;
  /**
   * Whether a Daily Value exists for this nutrient at all.
   *
   * Distinct from `dvPercent === null`, which a client would otherwise have to
   * read two ways. Protein carries no Daily Value and never will; sodium does
   * but may be unmeasured. The first is a blank cell, the second is the
   * em-dash the footnote defines as *not estimated* — collapsing them would
   * make that footnote a lie about four of the rows.
   */
  hasDailyValue: boolean;
  /** Share of the FDA reference amount, rounded to a whole percent. */
  dvPercent: number | null;
  /** Whether the user has an active goal for this nutrient in this period. */
  hasTarget: boolean;
  /** Share of this user's BL-0038 target for the same period. */
  targetPercent: number | null;
}

export interface NutritionFactsOptions {
  /**
   * What to divide the vector by: a recipe's serving count, or 1 for a day (the
   * period the Daily Value is defined against). A non-positive or non-finite
   * divisor yields a panel of the same shape with every amount unknown, rather
   * than an Infinity or a silent fallback to whole-recipe figures.
   */
  divisor?: number;
  /** The user's goals (BL-0038). Only active ones for `period` are consulted. */
  targets?: readonly NutritionTarget[];
  /**
   * Which period the vector covers.
   *
   * Required alongside `targets` for the same reason `evaluateTargets` demands
   * it: judging a week's protein goal against one day's total is the easiest
   * mistake available here, and no type can catch it.
   */
  period?: NutritionTargetPeriod;
}

/**
 * Units that name the same magnitude. FDC writes micrograms as `µg`, most hand
 * entry writes `mcg`, and some sources write `ug`; a Daily Value must not go
 * uncomputed over the spelling.
 */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  µg: "µg",
  ug: "µg",
  mcg: "µg",
  iu: "iu",
  g: "g",
  mg: "mg",
  kcal: "kcal",
};

function normalizeUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? key;
}

/**
 * A percentage only when the two amounts are in the same unit.
 *
 * Comparing 2.3 g of sodium against a 2,300 mg reference would print `0%` on a
 * day that blew through the reference — a wrong number that looks right is worse
 * on this panel than no number at all, so a unit we cannot reconcile yields
 * `null` and the cell renders as unknown.
 */
function percentOf(amount: NutrientAmount, reference: DailyValue): number | null {
  if (!(reference.amount > 0) || !Number.isFinite(amount.amount)) return null;
  if (amount.unit && normalizeUnit(amount.unit) !== normalizeUnit(reference.unit)) return null;
  return Math.round((amount.amount / reference.amount) * 100);
}

/**
 * The user's goal for one nutrient in this period, as a reference amount.
 *
 * A target carries no unit of its own — it is written against the nutrient
 * catalog's unit — so we take the estimate's unit, which makes `percentOf`'s
 * unit guard a no-op here by construction rather than by accident.
 */
function targetFor(
  nutrientId: string,
  options: NutritionFactsOptions,
): NutritionTarget | undefined {
  const { targets, period } = options;
  if (!targets || !period) return undefined;
  return targets.find(
    (t) => t.active && t.period === period && t.nutrientId === nutrientId && t.value > 0,
  );
}

/**
 * Builds the panel's rows from one nutrient vector.
 *
 * The `%DV` and `You` figures are always both computed; which of them a client
 * renders is a prop. That is what keeps a later "show Daily Value / my goals /
 * both" preference a UI change with no data or schema work behind it.
 *
 * This function decides nothing about whether a panel may be shown at all —
 * that remains the coverage rule in `summarizeNutrition` / `nutritionDisplay`,
 * so a familiar-looking, quasi-official label can never appear over figures the
 * rest of the system has agreed not to trust.
 */
export function nutritionFactsLabel(
  vector: Record<string, NutrientAmount> | undefined,
  options: NutritionFactsOptions = {},
): NutritionFactsRow[] {
  const { divisor = 1 } = options;
  const usable = vector && Number.isFinite(divisor) && divisor > 0;

  return ROWS.map(({ id, label, indent, group }) => {
    const dv = DAILY_VALUES[id];
    const target = targetFor(id, options);
    const base = {
      id,
      label,
      indent,
      group,
      hasDailyValue: dv !== undefined,
      hasTarget: target !== undefined,
    };

    const measured = usable ? vector[id] : undefined;
    if (!measured) return { ...base, amount: null, dvPercent: null, targetPercent: null };

    const amount: NutrientAmount = { ...measured, amount: measured.amount / divisor };

    return {
      ...base,
      amount,
      dvPercent: dv ? percentOf(amount, dv) : null,
      // A target carries no unit of its own — it is written against the nutrient
      // catalog's unit — so it is scored in the estimate's own unit, which makes
      // `percentOf`'s unit guard a no-op here by construction, not by accident.
      targetPercent: target ? percentOf(amount, { amount: target.value, unit: amount.unit }) : null,
    };
  });
}

/**
 * Whether the user has a goal on any nutrient this panel prints.
 *
 * Drives collapsing the panel back to the classic two-column layout that fits a
 * phone: a user with no active target touching these nutrients should not pay
 * for a permanently empty third column.
 *
 * It asks whether a *goal exists*, not whether one could be scored. A protein
 * goal we could not measure still earns its column, showing an em-dash — a user
 * who set that goal is owed "we can't tell you" rather than the goal's silent
 * disappearance at the moment we stopped being able to answer it.
 */
export function hasTargetColumn(rows: readonly NutritionFactsRow[]): boolean {
  return rows.some((row) => row.hasTarget);
}
