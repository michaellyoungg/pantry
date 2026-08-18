/**
 * The week planner, native: presentation over `usePlanWeek()`.
 *
 * A day-at-a-time pager rather than web's seven-column grid, and what that
 * decides is written up in `docs/backlog/BL-0064-native-week-planner.md`.
 */
import { weekdayOf } from "@pantry/core";
import { usePlanPrep, type WeekPlanRow, usePlanWeek } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { DayPager } from "./DayPager";
import { MoveToDaySheet } from "./MoveToDaySheet";
import { PlannedMeal } from "./PlannedMeal";
import { SuggestWeekCard } from "./SuggestWeekCard";
import { UnplannedRail } from "./UnplannedRail";

const id = surfaceTestIDs("plan");

export function PlanScreen() {
  // The tab navigator renders no header (`headerShown: false`), so the screen
  // owns its own top inset.
  const insets = useSafeAreaInsets();
  const {
    items,
    days,
    unscheduled,
    loading,
    generating,
    error,
    canGenerate,
    schedule,
    unschedule,
    increaseServings,
    decreaseServings,
    toggleType,
    toggleCooked,
    remove,
    buildList,
  } = usePlanWeek();

  const { meals: prepMeals, done: prepDone } = usePlanPrep();
  const prepByRecipe = new Map(prepMeals.map((m) => [m.recipeId, m]));

  // Opening on today is the only defensible default: the question a planner is
  // opened with is almost always "what am I cooking tonight?".
  const [selected, setSelected] = useState(() => weekdayOf(new Date()));
  const [moving, setMoving] = useState<WeekPlanRow | null>(null);

  const day = days[selected];

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
      >
        <View className="gap-1">
          <Text className="text-2xl font-semibold text-text" testID={id("title")}>
            Plan your week
          </Text>
          <Text className="text-sm text-muted">
            Put dinners on days, then build one grocery list for the week.
          </Text>
        </View>

        <DayPager days={days} onSelect={setSelected} selected={selected} />

        <View className="gap-2">
          <Text className="text-lg font-semibold text-text" testID={id("day-title")}>
            {day.fullLabel}
          </Text>

          {loading && (
            <Text className="text-sm text-muted" testID={id("loading")}>
              Loading your week…
            </Text>
          )}

          {!loading && day.items.length === 0 && (
            <Text className="text-sm text-muted" testID={id("day-empty")}>
              No dinner planned. Pick something from below, or let us suggest a week.
            </Text>
          )}

          {day.items.map((row) => (
            <PlannedMeal
              key={row._id}
              onDecreaseServings={() => decreaseServings(row)}
              onIncreaseServings={() => increaseServings(row)}
              onMove={() => setMoving(row)}
              onToggleCooked={() => toggleCooked(row)}
              onToggleType={() => toggleType(row)}
              prep={prepByRecipe.get(row.recipeId)}
              prepDone={prepDone}
              row={row}
            />
          ))}
        </View>

        <UnplannedRail
          dayLabel={day.fullLabel}
          onRemove={remove}
          onSchedule={(row) => schedule(row, selected)}
          rows={unscheduled}
        />

        <SuggestWeekCard items={items} />

        <Pressable
          accessibilityLabel="Generate grocery list"
          accessibilityRole="button"
          accessibilityState={{ disabled: generating || !canGenerate }}
          className={`items-center justify-center rounded-lg bg-primary px-4 ${
            generating || !canGenerate ? "opacity-50" : ""
          }`}
          disabled={generating || !canGenerate}
          onPress={() => void buildList()}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={TEST_IDS.plan.generate}
        >
          <Text className="text-base font-medium text-surface">
            {generating ? "Generating…" : "Generate grocery list"}
          </Text>
        </Pressable>

        {error !== null && (
          <Text className="text-sm text-danger" testID={id("error")}>
            {error}
          </Text>
        )}
      </ScrollView>

      {moving !== null && (
        <MoveToDaySheet
          onClose={() => setMoving(null)}
          onMove={(weekday) => {
            setSelected(weekday);
            schedule(moving, weekday);
            setMoving(null);
          }}
          onUnschedule={() => {
            unschedule(moving);
            setMoving(null);
          }}
          title={moving.title}
          weekday={moving.weekday}
        />
      )}
    </View>
  );
}
