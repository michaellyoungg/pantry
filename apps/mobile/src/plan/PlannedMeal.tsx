/**
 * One meal on the selected day. Web packs the same five controls into a ~120pt
 * grid cell, which only works with a cursor.
 */
import { isCooked, isLeftover, servingsMultiplier } from "@pantry/core";
import type { PlannedRow } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function PlannedMeal({
  row,
  onIncreaseServings,
  onDecreaseServings,
  onToggleType,
  onToggleCooked,
  onMove,
}: {
  row: PlannedRow;
  onIncreaseServings: () => void;
  onDecreaseServings: () => void;
  onToggleType: () => void;
  onToggleCooked: () => void;
  onMove: () => void;
}) {
  const key = testIDKey(row.title);
  const leftover = isLeftover(row);
  const cooked = isCooked(row);
  const multiplier = servingsMultiplier(row);

  return (
    <View
      className={`gap-3 rounded-xl border p-4 ${
        leftover ? "border-border bg-border/20" : "border-border bg-surface"
      }`}
      testID={TEST_IDS.plan.meal(row.title)}
    >
      <Text
        className={`text-base font-medium ${cooked ? "text-muted line-through" : "text-text"}`}
        testID={id("meal-title", key)}
      >
        {row.title}
      </Text>

      {leftover ? (
        <Text className="text-sm text-muted" testID={id("leftover-note", key)}>
          Leftovers — nothing to buy for this one.
        </Text>
      ) : (
        <View className="flex-row items-center gap-3">
          <Stepper
            direction="down"
            label={`Fewer servings of ${row.title}`}
            onPress={onDecreaseServings}
            testID={id("servings-down", key)}
          />
          <Text className="min-w-12 text-center text-base text-text" testID={id("servings", key)}>
            ×{multiplier}
          </Text>
          <Stepper
            direction="up"
            label={`More servings of ${row.title}`}
            onPress={onIncreaseServings}
            testID={id("servings-up", key)}
          />
        </View>
      )}

      <View className="flex-row flex-wrap gap-2">
        <Action
          label={
            cooked
              ? `Mark ${row.title} as not ${leftover ? "eaten" : "cooked"}`
              : `Mark ${row.title} as ${leftover ? "eaten" : "cooked"}`
          }
          onPress={onToggleCooked}
          selected={cooked}
          testID={id("cooked", key)}
          text={cooked ? "✓ Done" : leftover ? "Eaten?" : "Cooked?"}
        />
        <Action
          label={leftover ? `Mark ${row.title} as a meal` : `Mark ${row.title} as leftovers`}
          onPress={onToggleType}
          selected={leftover}
          testID={id("type", key)}
          text={leftover ? "↩ Meal" : "♻ Leftovers"}
        />
        <Action
          label={`Move ${row.title} to another day`}
          onPress={onMove}
          testID={id("move", key)}
          text="Move"
        />
      </View>
    </View>
  );
}

function Stepper({
  direction,
  label,
  onPress,
  testID,
}: {
  direction: "up" | "down";
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="w-14 items-center justify-center rounded-lg border border-border bg-surface"
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className="text-xl text-text">{direction === "up" ? "+" : "−"}</Text>
    </Pressable>
  );
}

function Action({
  label,
  onPress,
  selected,
  testID,
  text,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  testID: string;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true }}
      className={`items-center justify-center rounded-full border px-4 ${
        selected ? "border-primary bg-primary/10" : "border-border"
      }`}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-sm font-medium ${selected ? "text-primary" : "text-text"}`}>
        {text}
      </Text>
    </Pressable>
  );
}
