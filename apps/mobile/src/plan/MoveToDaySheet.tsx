/**
 * Moving a meal between days, without a drag.
 *
 * "Off the plan" sits here too: "not this day" and "not this week" are the same
 * decision arriving a moment apart.
 */
import { DAY_FULL, DAYS } from "@pantry/core";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { Sheet, SheetButton } from "../components/Sheet";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function MoveToDaySheet({
  title,
  weekday,
  onMove,
  onUnschedule,
  onClose,
}: {
  title: string;
  /** The day it is on now, greyed out as a target. */
  weekday?: number;
  onMove: (weekday: number) => void;
  onUnschedule: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} testID={id("move-sheet")} title={`Move ${title} to…`}>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {DAYS.map((label, day) => {
          const current = day === weekday;
          return (
            <Pressable
              accessibilityLabel={
                current ? `${DAY_FULL[day]} — already there` : `Move ${title} to ${DAY_FULL[day]}`
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: current, selected: current }}
              className={`grow basis-[28%] items-center justify-center rounded-lg border ${
                current ? "border-primary bg-primary/10" : "border-border bg-surface"
              }`}
              disabled={current}
              key={label}
              onPress={() => onMove(day)}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("move-to", testIDKey(label))}
            >
              <Text className={`text-base ${current ? "text-primary" : "text-text"}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SheetButton
        label="Take off the plan"
        onPress={onUnschedule}
        testID={id("move-unschedule")}
        tone="secondary"
      />
      <SheetButton label="Cancel" onPress={onClose} testID={id("move-cancel")} tone="quiet" />
    </Sheet>
  );
}
