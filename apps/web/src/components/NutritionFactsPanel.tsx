import {
  formatNutrientAmount,
  hasTargetColumn,
  NUTRITION_FACTS_FOOTNOTES,
  NUTRITION_FACTS_NOT_ESTIMATED,
  NUTRITION_FACTS_TITLE,
  type NutritionFactsRow,
} from "@pantry/core";

/**
 * The Nutrition Facts panel (BL-0049).
 *
 * Purely presentational: it takes rows built by `nutritionFactsLabel` and draws
 * them. Every decision that could be got *wrong* — the percentages, the row
 * order, whether a nutrient was measured — happens in `@pantry/core` and is
 * tested without a DOM. What is left here is the shape, and the shape is the
 * point: recognizability comes from the rules, the hanging indents and the
 * right-hand column, not from the presence of a percentage.
 *
 * It is a real `<table>` with scoped headers rather than a div grid, because the
 * row-and-column relationship the visual rules are drawing is information, and
 * assistive technology should get it too. The native panel (BL-0065) has no
 * table to reach for and rebuilds that relationship out of accessible labels;
 * the title, the em-dash and the footnotes come from `@pantry/core` so the two
 * cannot say different things.
 */

export interface NutritionFactsPanelProps {
  rows: readonly NutritionFactsRow[];
  /**
   * What one column of figures covers: `"4 servings per recipe"`,
   * `"Entire recipe"`, `"Whole day"`.
   *
   * Deliberately a serving *count* and never a serving *size*. A real panel
   * names the serving ("1 cup"); we know how many servings a recipe makes and
   * nothing about what one of them weighs, so there is no serving-size line to
   * invent.
   */
  servingsLabel: string;
  /** 0..100. Below 100 the panel says how much of the food it accounted for. */
  coveragePercent?: number;
  /**
   * Whether to draw the personal column. Defaults to "when the user has a goal
   * on one of these nutrients", which returns the panel to the classic
   * two-column layout that fits a phone for everyone else.
   */
  showTargets?: boolean;
  className?: string;
}

export function NutritionFactsPanel({
  rows,
  servingsLabel,
  coveragePercent,
  showTargets,
  className = "",
}: NutritionFactsPanelProps) {
  const withTargets = showTargets ?? hasTargetColumn(rows);
  const columns = withTargets ? 4 : 3;

  return (
    <section
      aria-label={NUTRITION_FACTS_TITLE}
      className={`rounded-lg border-2 border-text bg-surface p-3 text-text ${className}`}
    >
      <h3 className="text-2xl font-black leading-none tracking-tight">{NUTRITION_FACTS_TITLE}</h3>
      <p className="mt-1 text-sm font-medium">{servingsLabel}</p>
      {coveragePercent !== undefined && coveragePercent < 100 && (
        <p className="text-xs text-muted">{coveragePercent}% of ingredients accounted for</p>
      )}

      <table className="mt-2 w-full border-collapse text-left text-sm">
        <caption className="sr-only">
          Estimated nutrition, {servingsLabel}. Amounts and their share of a daily reference.
        </caption>
        <thead>
          <tr className="border-b-8 border-text">
            {/* The nutrient and its amount share one visual column — "Total fat
                12 g" is how a label reads — but stay separate cells so a screen
                reader announces a nutrient and an amount, not one run-on string. */}
            <th scope="col" className="sr-only">
              Nutrient
            </th>
            <th scope="col" className="sr-only">
              Amount
            </th>
            <th scope="col" className="pb-1 text-right align-bottom text-xs font-bold">
              % Daily Value
            </th>
            {withTargets && (
              <th scope="col" className="pb-1 text-right align-bottom text-xs font-bold">
                % of your goal
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Row
              key={row.id}
              row={row}
              withTargets={withTargets}
              columns={columns}
              // The heavy rule sits where the macro block ends, found from the
              // groups rather than from a row index, so inserting a nutrient can
              // never silently move it.
              startsGroup={index > 0 && rows[index - 1].group !== row.group}
            />
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex flex-col gap-1 border-t-4 border-text pt-2 text-xs text-muted">
        {NUTRITION_FACTS_FOOTNOTES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}

const INDENT = ["pl-0", "pl-4", "pl-8"] as const;

function Row({
  row,
  withTargets,
  columns,
  startsGroup,
}: {
  row: NutritionFactsRow;
  withTargets: boolean;
  columns: number;
  startsGroup: boolean;
}) {
  const isCalories = row.group === "calories";
  // Only a top-level line is bold, exactly as on the printed label: the bolding
  // is what tells you "saturated fat" is part of "total fat" above it.
  const weight = row.indent === 0 ? "font-bold" : "font-normal";
  const edge = startsGroup ? "border-t-8 border-text" : "border-t border-border";

  if (isCalories) {
    return (
      <tr className={edge}>
        <th scope="row" className="py-1 align-baseline text-base font-black">
          {row.label}
        </th>
        <td colSpan={columns - 1} className="py-1 text-right align-baseline text-2xl font-black">
          {row.amount ? formatNutrientAmount(row.amount) : NUTRITION_FACTS_NOT_ESTIMATED}
        </td>
      </tr>
    );
  }

  return (
    <tr className={edge}>
      <th scope="row" className={`py-0.5 align-baseline ${weight} ${INDENT[row.indent]}`}>
        {row.label}
      </th>
      <td className="py-0.5 pl-2 align-baseline">
        {row.amount ? formatNutrientAmount(row.amount) : NUTRITION_FACTS_NOT_ESTIMATED}
      </td>
      <PercentCell has={row.hasDailyValue} percent={row.dvPercent} />
      {withTargets && <PercentCell has={row.hasTarget} percent={row.targetPercent} />}
    </tr>
  );
}

/**
 * One percentage cell.
 *
 * The two ways a percentage can be absent are drawn differently on purpose. A
 * nutrient that *has* no Daily Value — protein, trans fat, total sugars — leaves
 * the cell blank, as the printed label does. A nutrient that has one but which
 * we could not measure prints the em-dash, which the footnote defines. Drawing
 * both as a dash would make that footnote wrong about four rows; drawing both as
 * blank would hide the fact that we failed to estimate something.
 */
function PercentCell({ has, percent }: { has: boolean; percent: number | null }) {
  if (!has) return <td className="py-0.5 text-right align-baseline" />;
  return (
    <td className="py-0.5 pl-2 text-right align-baseline font-bold">
      {percent === null ? NUTRITION_FACTS_NOT_ESTIMATED : `${percent}%`}
    </td>
  );
}
