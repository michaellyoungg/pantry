/**
 * The Nutrition Facts panel, native (BL-0049, ported by BL-0065).
 *
 * Purely presentational: it takes rows built by `nutritionFactsLabel` and draws
 * them. Every decision that could be got *wrong* — the percentages, the row
 * order, whether a nutrient was measured — happens in `@pantry/core` and is
 * tested without a renderer. What is left here is the shape, and the shape is
 * the point: recognizability comes from the rules, the hanging indents and the
 * right-hand column, not from the presence of a percentage.
 *
 * Web draws a real `<table>` with scoped headers, because the row-and-column
 * relationship the rules are drawing is information and assistive technology
 * should get it too. React Native has no table and no scoped headers, so each
 * row is instead one `accessible` group carrying the whole relationship in its
 * label — "Sodium, 890 mg, 39% of Daily Value" — which is the same information
 * by the only means this platform offers.
 *
 * On a phone the four-column layout is the tight case, so the two percentage
 * columns are fixed and the nutrient column takes what is left and wraps. A
 * label that wraps still reads as a label; one that pushes its percentage off
 * the edge does not.
 */
import {
  formatNutrientAmount,
  hasTargetColumn,
  NUTRITION_FACTS_FOOTNOTES,
  NUTRITION_FACTS_NOT_ESTIMATED,
  NUTRITION_FACTS_TITLE,
  type NutritionFactsRow,
} from "@pantry/core";
import { Text, View } from "react-native";
import { surfaceTestIDs, type TestIDSurface } from "../testing/testIDs";

export interface NutritionFactsPanelProps {
  rows: readonly NutritionFactsRow[];
  /**
   * What one column of figures covers: `"4 servings per recipe"`,
   * `"Entire recipe"`, `"Monday · whole day"`.
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
  /** The screen this panel is on, so its ids sit in that screen's namespace. */
  surface: TestIDSurface;
}

/** Hanging indents, matching web's `pl-0` / `pl-4` / `pl-8`. */
const INDENT = ["pl-0", "pl-4", "pl-8"] as const;

export function NutritionFactsPanel({
  rows,
  servingsLabel,
  coveragePercent,
  showTargets,
  surface,
}: NutritionFactsPanelProps) {
  const id = surfaceTestIDs(surface);
  const withTargets = showTargets ?? hasTargetColumn(rows);

  return (
    <View
      accessibilityLabel={NUTRITION_FACTS_TITLE}
      className="rounded-lg border-2 border-text bg-surface p-3"
      testID={id("nutrition-facts")}
    >
      <Text className="text-2xl font-black text-text">{NUTRITION_FACTS_TITLE}</Text>
      <Text className="mt-1 text-sm font-medium text-text" testID={id("nutrition-servings")}>
        {servingsLabel}
      </Text>
      {coveragePercent !== undefined && coveragePercent < 100 && (
        <Text className="text-xs text-muted" testID={id("nutrition-coverage")}>
          {coveragePercent}% of ingredients accounted for
        </Text>
      )}

      {/* The heavy rule under the column headings. The nutrient and its amount
          need no heading — "Total fat 12 g" is how a label reads — so the row
          is right-aligned and holds only the percentage columns. */}
      <View className="mt-2 flex-row items-end justify-end border-b-8 border-text pb-1">
        <Text className="w-16 text-right text-xs font-bold text-text">% Daily Value</Text>
        {withTargets && (
          <Text className="w-16 text-right text-xs font-bold text-text">% of your goal</Text>
        )}
      </View>

      {rows.map((row, index) => (
        <Row
          key={row.id}
          row={row}
          withTargets={withTargets}
          // The heavy rule sits where the macro block ends, found from the
          // groups rather than from a row index, so inserting a nutrient can
          // never silently move it. Row 0 draws no rule at all: web's collapses
          // into the header's, and React Native has no border collapsing.
          edge={index === 0 ? "none" : rows[index - 1].group !== row.group ? "group" : "row"}
        />
      ))}

      <View className="mt-2 gap-1 border-t-4 border-text pt-2" testID={id("nutrition-footnotes")}>
        {NUTRITION_FACTS_FOOTNOTES.map((line) => (
          <Text className="text-xs text-muted" key={line}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

type Edge = "none" | "row" | "group";

const EDGE_CLASS: Record<Edge, string> = {
  none: "",
  row: "border-t border-border",
  group: "border-t-8 border-text",
};

/** The amount as it prints, or the em-dash the footnote defines. */
function amountText(row: NutritionFactsRow): string {
  return row.amount ? formatNutrientAmount(row.amount) : NUTRITION_FACTS_NOT_ESTIMATED;
}

/**
 * The row's whole meaning as one sentence, for a screen reader.
 *
 * Web gets this from the table: a row header plus column headers announce
 * "Sodium, 890 mg, % Daily Value 39%". Nothing here does that automatically, so
 * the row says it. `NUTRITION_FACTS_NOT_ESTIMATED` is spelled out rather than
 * spoken as a dash — a punctuation mark a reader may or may not voice is not a
 * place to put the difference between "we don't know" and "zero".
 */
function rowLabel(row: NutritionFactsRow, withTargets: boolean): string {
  const parts = [row.label, row.amount ? formatNutrientAmount(row.amount) : "not estimated"];
  if (row.hasDailyValue) {
    parts.push(
      row.dvPercent === null ? "Daily Value not estimated" : `${row.dvPercent}% of the Daily Value`,
    );
  }
  if (withTargets && row.hasTarget) {
    parts.push(
      row.targetPercent === null ? "your goal not estimated" : `${row.targetPercent}% of your goal`,
    );
  }
  return parts.join(", ");
}

function Row({
  row,
  withTargets,
  edge,
}: {
  row: NutritionFactsRow;
  withTargets: boolean;
  edge: Edge;
}) {
  // Only a top-level line is bold, exactly as on the printed label: the bolding
  // is what tells you "saturated fat" is part of "total fat" above it.
  const weight = row.indent === 0 ? "font-bold" : "font-normal";

  if (row.group === "calories") {
    return (
      <View
        accessibilityLabel={rowLabel(row, withTargets)}
        accessible
        className={`flex-row items-baseline justify-between py-1 ${EDGE_CLASS[edge]}`}
      >
        <Text className="text-base font-black text-text">{row.label}</Text>
        <Text className="text-2xl font-black text-text">{amountText(row)}</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={rowLabel(row, withTargets)}
      accessible
      className={`flex-row items-baseline py-0.5 ${EDGE_CLASS[edge]}`}
    >
      <View className={`flex-1 flex-row flex-wrap items-baseline ${INDENT[row.indent]}`}>
        <Text className={`text-sm text-text ${weight}`}>{row.label}</Text>
        <Text className="pl-2 text-sm text-text">{amountText(row)}</Text>
      </View>
      <PercentCell has={row.hasDailyValue} percent={row.dvPercent} />
      {withTargets && <PercentCell has={row.hasTarget} percent={row.targetPercent} />}
    </View>
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
  if (!has) return <View className="w-16" />;
  return (
    <Text className="w-16 pl-2 text-right text-sm font-bold text-text">
      {percent === null ? NUTRITION_FACTS_NOT_ESTIMATED : `${percent}%`}
    </Text>
  );
}
