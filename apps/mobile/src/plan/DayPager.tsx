/**
 * One day at a time, chosen from a strip of seven. Seven columns at 390pt gives
 * each day ~50pt, which is not enough for a recipe title.
 */
import type { PlannedDay } from "@pantry/core";
import type { PlannedRow } from "@pantry/core/data";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function DayPager({
  days,
  selected,
  onSelect,
}: {
  days: PlannedDay<PlannedRow>[];
  selected: number;
  onSelect: (weekday: number) => void;
}) {
  return (
    <View className="flex-row gap-1" testID={id("day-pager")}>
      {days.map((day) => {
        const active = day.weekday === selected;
        const count = day.items.length;
        return (
          <Pressable
            accessibilityLabel={
              count === 0
                ? `${day.fullLabel} — nothing planned`
                : `${day.fullLabel} — ${count === 1 ? "1 meal" : `${count} meals`}`
            }
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center justify-center gap-1 rounded-lg border py-2 ${
              active ? "border-primary bg-primary" : "border-border bg-surface"
            }`}
            key={day.label}
            onPress={() => onSelect(day.weekday)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("day", testIDKey(day.label))}
          >
            <Text
              className={`text-xs font-semibold ${active ? "text-surface" : "text-muted"}`}
              numberOfLines={1}
            >
              {day.label}
            </Text>
            {/* A dot, not a count: at this width the number is the widest thing
                in the cell, and the strip is scanned for "anything on Thursday?" */}
            <View
              className={`h-1.5 w-1.5 rounded-full ${
                count === 0 ? "bg-transparent" : active ? "bg-surface" : "bg-primary"
              }`}
              testID={count === 0 ? undefined : id("day-dot", testIDKey(day.label))}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
