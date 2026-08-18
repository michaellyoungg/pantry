/**
 * The week's estimated nutrition (BL-0037), native. Presentation over
 * `usePlanNutrition()`.
 *
 * Every figure is labelled *estimated* and every incomplete one says what it is
 * missing. That is the whole point of the surface: a day whose dinner we could
 * not account for must read as a day we could not account for, never as a
 * quietly smaller number.
 *
 * The composition diverges from web, and that is the point. There, seven days
 * are listed at once beneath a seven-column grid. Here the planner is a pager
 * (BL-0064) — one day at a time — so this card answers for the week and for the
 * day you are looking at, and paging is how you reach the rest. Nothing is
 * unreachable, and the phone is not asked to hold seven repeated blocks of
 * chips and totals under an already long screen.
 */
import type {
  NutritionGaps,
  PlanNutritionDay,
  PlannedItem,
  WeekNutritionRollup,
} from "@pantry/core";
import { usePlanNutrition } from "@pantry/core/data";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { NutritionFactsPanel } from "./NutritionFactsPanel";
import { PlanGoals } from "./PlanGoals";

const id = surfaceTestIDs("plan");

export function PlanNutrition({
  items,
  weekday,
}: {
  items: readonly PlannedItem[];
  /** The day the pager is on. Its figures are the ones shown in full. */
  weekday: number;
}) {
  const { view, loading, error, reload } = usePlanNutrition(items);

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4" testID={id("nutrition")}>
      <Text className="text-lg font-semibold text-text">Estimated nutrition</Text>

      {error !== null && (
        <View className="gap-2" testID={id("nutrition-error")}>
          <Text className="text-sm text-danger">{error}</Text>
          <Pressable
            accessibilityLabel="Try estimating this week again"
            accessibilityRole="button"
            className="items-center justify-center self-start rounded-lg border border-border px-4"
            onPress={reload}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("nutrition-retry")}
          >
            <Text className="text-sm font-medium text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {error === null && view === null && (
        <Text className="text-sm text-muted" testID={id("nutrition-pending")}>
          {loading ? "Estimating this week's nutrition…" : "Nothing to estimate yet."}
        </Text>
      )}

      {error === null && view !== null && view.rollup.plannedDays === 0 && (
        <Text className="text-sm text-muted" testID={id("nutrition-empty")}>
          Put a recipe on a day to see what your week comes to.
        </Text>
      )}

      {error === null && view !== null && view.rollup.plannedDays > 0 && (
        <>
          <WeekSummary rollup={view.rollup} />
          <DaySection day={view.days.find((d) => d.weekday === weekday)} />
          {/* Goal status against the very same rollup (BL-0038). Sharing the one
              fetch is what keeps the two halves of this card from ever
              disagreeing about whether a day is knowable.

              Narrowed to the paged-to day for the same reason the day section
              is: the week's goals answer for the week, and the day you are
              looking at answers for itself. */}
          {view.goals !== null && (
            <PlanGoals
              goals={{
                week: view.goals.week,
                days: view.goals.days?.filter((d) => d.weekday === weekday) ?? null,
              }}
            />
          )}
          {loading && <Text className="text-xs text-muted">Refreshing…</Text>}
        </>
      )}
    </View>
  );
}

function WeekSummary({ rollup }: { rollup: WeekNutritionRollup }) {
  const { week, dailyAverage, plannedDays } = rollup;
  const days = `${plannedDays} planned ${plannedDays === 1 ? "day" : "days"}`;

  if (week.kind !== "estimate") {
    return (
      <View className="gap-1 rounded-lg bg-border/30 p-3" testID={id("nutrition-week")}>
        <Text className="text-sm text-text">
          Not enough of this week could be identified to estimate it
          {week.kind === "unavailable" && ` (about ${week.coveragePercent}% accounted for)`}.
        </Text>
        {week.kind === "unavailable" && <GapNote gaps={week.gaps} />}
      </View>
    );
  }

  return (
    <View className="gap-1 rounded-lg bg-primary/10 p-3" testID={id("nutrition-week")}>
      <Text className="text-xs uppercase tracking-wide text-muted">
        Estimated average per day · across {days}
      </Text>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        {dailyAverage.map((row) => (
          <View className="gap-0.5" key={row.id}>
            <Text className="text-xs text-muted">{row.label}</Text>
            <Text className="text-sm font-medium text-text">{row.value}</Text>
          </View>
        ))}
      </View>
      <Text className="text-xs text-muted">
        Week total: {week.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}
      </Text>
      <GapNote gaps={week.gaps} />
    </View>
  );
}

/**
 * The paged-to day, in full.
 *
 * Nothing at all when that day holds no food: the pager above already says the
 * day is empty, and a second sentence saying it again is noise inside a card
 * whose week-level answer is still worth reading.
 */
function DaySection({ day }: { day: PlanNutritionDay | undefined }) {
  const [open, setOpen] = useState(false);

  if (!day) return null;

  const { summary } = day;

  return (
    <View className="gap-2" testID={id("nutrition-day")}>
      <Text className="text-sm font-medium text-text">{day.fullLabel}</Text>
      {summary.kind === "estimate" ? (
        <Text className="text-sm text-muted" testID={id("nutrition-day-total")}>
          {summary.rows.map((r) => `${r.label} ${r.value}`).join(" · ")}
        </Text>
      ) : (
        <Text className="text-sm text-muted" testID={id("nutrition-day-total")}>
          Not enough identified to estimate
          {summary.kind === "unavailable" && ` (about ${summary.coveragePercent}%)`}
        </Text>
      )}
      {summary.kind !== "empty" && <GapNote gaps={summary.gaps} />}

      {/* Only a day we would put a number on gets a panel, and the rollup
          decides that — `factsRows` is empty for every other day. A
          quasi-official label over figures the rest of the app has agreed not
          to trust is the artifact this whole track exists to prevent. */}
      {day.factsRows.length > 0 && (
        <>
          <Pressable
            accessibilityLabel={
              open ? "Hide Nutrition Facts" : `Show Nutrition Facts for ${day.fullLabel}`
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            className="items-center justify-center self-start rounded-lg border border-border px-4"
            onPress={() => setOpen(!open)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("nutrition-facts-toggle")}
          >
            <Text className="text-sm font-medium text-text">
              {open ? "Hide Nutrition Facts" : "Nutrition Facts"}
            </Text>
          </Pressable>
          {open && (
            <NutritionFactsPanel
              coveragePercent={summary.kind === "estimate" ? summary.coveragePercent : undefined}
              rows={day.factsRows}
              servingsLabel={`${day.fullLabel} · whole day`}
              surface="plan"
            />
          )}
        </>
      )}
    </View>
  );
}

/**
 * Names what is unaccounted for. An excluded recipe leads, because it is the
 * gap a coverage percentage physically cannot express — none of its food is in
 * either side of that ratio, so without this line the total would read as
 * complete.
 */
function GapNote({ gaps }: { gaps: NutritionGaps }) {
  if (!gaps.incomplete) return null;
  return (
    <View className="gap-0.5" testID={id("nutrition-gaps")}>
      {gaps.excludedRecipes.length > 0 && (
        <Text className="text-xs text-muted">
          Excluded — we couldn't read{" "}
          <Text className="text-text">{gaps.excludedRecipes.join(", ")}</Text>, so none of it is in
          these figures.
        </Text>
      )}
      {gaps.partialRecipes.length > 0 && (
        <Text className="text-xs text-muted">
          Only partly counted: <Text className="text-text">{gaps.partialRecipes.join(", ")}</Text>
        </Text>
      )}
      {gaps.missingItems.length > 0 && (
        <Text className="text-xs text-muted">
          Not counted: <Text className="text-text">{gaps.missingItems.join(", ")}</Text>
        </Text>
      )}
    </View>
  );
}
