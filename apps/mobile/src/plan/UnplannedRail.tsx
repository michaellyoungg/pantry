/**
 * Basket recipes with no day yet. The pager above has already established which
 * day is meant, so planning one is a single tap rather than a picker per row.
 */
import type { PlannedRow } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function UnplannedRail({
  rows,
  dayLabel,
  onSchedule,
  onRemove,
}: {
  rows: PlannedRow[];
  /** The day the pager is showing — where one tap puts a recipe. */
  dayLabel: string;
  onSchedule: (row: PlannedRow) => void;
  onRemove: (row: PlannedRow) => void;
}) {
  return (
    <View className="gap-2" testID={id("rail")}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
        Not yet planned
      </Text>

      {rows.length === 0 ? (
        <Text className="text-sm text-muted" testID={id("rail-empty")}>
          Everything in your basket is on a day. Add recipes from the Recipes tab to plan more.
        </Text>
      ) : (
        rows.map((row) => {
          const key = testIDKey(row.title);
          return (
            <View
              className="gap-3 rounded-xl border border-border bg-surface p-4"
              key={row._id}
              testID={TEST_IDS.plan.unplanned(row.title)}
            >
              <Text className="text-base text-text">{row.title}</Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  accessibilityLabel={`Plan ${row.title} for ${dayLabel}`}
                  accessibilityRole="button"
                  className="flex-1 items-center justify-center rounded-lg bg-primary px-4"
                  onPress={() => onSchedule(row)}
                  style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                  testID={id("rail-schedule", key)}
                >
                  <Text className="text-base font-medium text-surface">Plan for {dayLabel}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Remove ${row.title} from your basket`}
                  accessibilityRole="button"
                  className="items-center justify-center rounded-lg border border-border px-4"
                  onPress={() => onRemove(row)}
                  style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                  testID={id("rail-remove", key)}
                >
                  <Text className="text-base text-muted">Remove</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
