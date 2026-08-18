/**
 * The week at a glance, native (BL-0062).
 *
 * The buckets come from `useHome()`, which fills them with the planner's own
 * `planWeek()` — the same seven-day split the web strip and the planner grid
 * render from.
 *
 * The layout diverges from web on purpose. Seven columns is a desktop shape;
 * at phone width it gives each day about forty points, which is not enough for
 * a recipe title and turns every cell into an ellipsis. Seven full-width rows
 * read down the screen instead, and each row is a whole tap target.
 *
 * Read-and-route, as on web: rows go to the planner rather than deep-linking a
 * focused day, because `/plan` has no day parameter yet.
 */
import type { PlannedDay } from "@pantry/core";
import type { HomeMeal } from "@pantry/core/data";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("home");

/** What one planned row is called, leftovers marked. Used for both eyes and screen readers. */
function describe(row: HomeMeal): string {
  return row.type === "leftover" ? `${row.title} (leftovers)` : row.title;
}

export function WeekStrip({
  days,
  unscheduled,
  onOpenPlan,
}: {
  days: PlannedDay<HomeMeal>[];
  /**
   * Entries on no day yet. They appear in no row below but still count toward
   * "N meals ready" on the card above, so the strip has to say where they went
   * or the two numbers read as contradicting each other.
   */
  unscheduled: number;
  onOpenPlan: () => void;
}) {
  return (
    <View className="gap-2" testID={id("week-strip")}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">This week</Text>

      {days.map((day) => (
        <Pressable
          accessibilityLabel={
            day.items.length === 0
              ? `${day.fullLabel} — nothing planned, add a meal`
              : `${day.fullLabel} — ${day.items.map(describe).join(", ")}`
          }
          accessibilityRole="button"
          className="flex-row items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3"
          key={day.label}
          onPress={onOpenPlan}
          testID={id("day", testIDKey(day.label))}
        >
          <Text className="w-10 text-sm font-medium text-muted">{day.label}</Text>
          {day.items.length === 0 ? (
            <Text className="text-sm text-muted">+ add</Text>
          ) : (
            <View className="flex-1 gap-0.5">
              {day.items.map((row) => (
                <Text
                  className={`text-sm ${row.type === "leftover" ? "text-muted" : "text-text"}`}
                  key={row._id}
                  numberOfLines={1}
                >
                  {describe(row)}
                </Text>
              ))}
            </View>
          )}
        </Pressable>
      ))}

      {unscheduled > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenPlan}
          testID={id("unscheduled")}
          className="py-1"
        >
          <Text className="text-sm text-muted">
            {unscheduled === 1
              ? "1 meal not on a day yet"
              : `${unscheduled} meals not on a day yet`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
