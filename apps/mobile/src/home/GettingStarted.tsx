/**
 * Onboarding for the first pass through the weekly loop, native (BL-0062).
 *
 * It disappears once shopping starts — by then the loop speaks for itself.
 */
import type { HomeState } from "@pantry/core";
import { Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("home");

export function GettingStarted({ state }: { state: HomeState }) {
  if (state.kind !== "empty" && state.kind !== "planned") return null;

  // Only the first step can ever be done here: the card unmounts as soon as a
  // list exists, so steps 2 and 3 are always still ahead. They render as plain
  // upcoming steps rather than carrying a `done` flag that is structurally
  // always false.
  const steps = [
    { label: "Add meals to your week", done: state.kind === "planned" },
    { label: "Build your grocery list", done: false },
    { label: "Shop", done: false },
  ] as const;

  return (
    <View
      className="gap-2 rounded-xl border border-border bg-surface p-4"
      testID={id("getting-started")}
    >
      <Text className="text-lg font-semibold text-text">Getting started</Text>
      {steps.map((step, i) => (
        <View className="flex-row items-center gap-2" key={step.label}>
          <Text
            className={`h-6 w-6 rounded-full text-center text-xs leading-6 ${
              step.done ? "bg-primary text-surface" : "border border-border text-muted"
            }`}
          >
            {step.done ? "✓" : i + 1}
          </Text>
          <Text
            className={`text-sm ${step.done ? "text-muted line-through" : "text-text"}`}
            testID={id("step", testIDKey(step.label))}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
