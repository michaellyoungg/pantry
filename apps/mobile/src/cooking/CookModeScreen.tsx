/**
 * Cooking mode, native (BL-0061) — one step at a time, screen awake.
 *
 * This screen has no web counterpart, and it is the reason the parity plan
 * calls cooking "the second place a phone genuinely beats a laptop". The web
 * app renders the method as an ordered list because a laptop sits still at a
 * desk; a phone is propped against a mixing bowl at arm's length and read in
 * glances by someone whose hands are wet, so the method becomes ONE step, drawn
 * large (`legibility.ts`), with targets big enough to hit with a knuckle.
 *
 * Three native concerns it exists to handle:
 *
 * 1. **The screen must not sleep mid-recipe.** `useKeepAwake` holds it on for
 *    as long as this screen is mounted, and releases on unmount — so it is
 *    scoped to actually cooking rather than to having the app open.
 * 2. **Position must survive a glance away.** Which step you are on is state
 *    here rather than a route parameter: leaving cooking mode and coming back
 *    is a deliberate restart, but backgrounding the app is not.
 * 3. **Never a dead end.** The last step offers finishing rather than a
 *    disabled arrow, so the flow ends where it started — on the recipe.
 *
 * The data is `useRecipeDetail()`, the same hook the detail screen renders
 * from, so a recipe opened for cooking never disagrees with the recipe read a
 * moment earlier.
 */
import { useRecipeDetail } from "@pantry/core/data";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { surfaceTestIDs } from "../testing/testIDs";
import { STEP_CONTROL_HEIGHT, STEP_FONT_SIZE, STEP_LINE_HEIGHT } from "./legibility";

const id = surfaceTestIDs("recipes");

export function CookModeScreen({ recipeId }: { recipeId: string }) {
  // Held for the lifetime of this screen only. A recipe left open on the
  // counter is exactly when a phone locking itself is most expensive, and
  // exactly when the user's hands are least able to wake it.
  useKeepAwake();

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { recipe, loading, missing, error } = useRecipeDetail(recipeId);
  const [index, setIndex] = useState(0);

  const steps = recipe?.steps ?? [];
  // Clamped rather than trusted: the recipe arrives after the first render, and
  // it can be edited on another device while this screen is open.
  const current = Math.min(index, Math.max(steps.length - 1, 0));
  const onLastStep = current >= steps.length - 1;

  return (
    <View className="flex-1 bg-bg" testID={id("cook")} style={{ paddingTop: insets.top + 8 }}>
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="flex-1 text-base text-muted" numberOfLines={1}>
          {recipe?.title ?? ""}
        </Text>
        <Pressable
          accessibilityLabel="Stop cooking"
          accessibilityRole="button"
          className="rounded-full border border-border px-4 py-2.5"
          onPress={() => router.back()}
          testID={id("cook-close")}
        >
          <Text className="text-sm font-medium text-muted">Close</Text>
        </Pressable>
      </View>

      {loading && (
        <Text className="p-4 text-base text-muted" testID={id("cook-loading")}>
          Loading the recipe…
        </Text>
      )}

      {missing && (
        <Text className="p-4 text-base text-muted" testID={id("cook-missing")}>
          This recipe is no longer in your library.
        </Text>
      )}

      {error !== null && (
        <Text className="p-4 text-base text-danger" testID={id("cook-error")}>
          {error}
        </Text>
      )}

      {/* A recipe with no method is a shopping aid, not something to cook from
          step by step. Say so rather than showing an empty screen with two
          arrows on it. */}
      {recipe !== undefined && steps.length === 0 && (
        <Text className="p-4 text-base text-muted" testID={id("cook-no-steps")}>
          This recipe has no method written down yet.
        </Text>
      )}

      {steps.length > 0 && (
        <>
          <Text
            className="px-4 pb-2 text-sm font-semibold uppercase tracking-wide text-muted"
            testID={id("cook-progress")}
          >
            Step {current + 1} of {steps.length}
          </Text>

          {/* Scrollable, because a long step must not be cropped — but sized so
              a normal step never needs scrolling to be read. */}
          <ScrollView className="flex-1" contentContainerClassName="px-4 pb-4">
            <Text
              className="text-text"
              style={{ fontSize: STEP_FONT_SIZE, lineHeight: STEP_LINE_HEIGHT }}
              testID={id("cook-step")}
            >
              {steps[current]}
            </Text>
          </ScrollView>

          <View
            className="flex-row gap-3 border-t border-border bg-surface p-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Pressable
              accessibilityLabel="Previous step"
              accessibilityRole="button"
              accessibilityState={{ disabled: current === 0 }}
              className={`flex-1 items-center justify-center rounded-xl border border-border ${
                current === 0 ? "opacity-40" : ""
              }`}
              disabled={current === 0}
              onPress={() => setIndex(current - 1)}
              style={{ minHeight: STEP_CONTROL_HEIGHT }}
              testID={id("cook-previous")}
            >
              <Text className="text-lg font-semibold text-text">Back</Text>
            </Pressable>

            <Pressable
              accessibilityLabel={onLastStep ? "Finish cooking" : "Next step"}
              accessibilityRole="button"
              className="flex-1 items-center justify-center rounded-xl bg-primary"
              onPress={() => (onLastStep ? router.back() : setIndex(current + 1))}
              style={{ minHeight: STEP_CONTROL_HEIGHT }}
              testID={onLastStep ? id("cook-finish") : id("cook-next")}
            >
              <Text className="text-lg font-semibold text-surface">
                {onLastStep ? "Done" : "Next"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
