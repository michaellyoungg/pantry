/**
 * My Kitchen, native (BL-0063): presentation over `useMyKitchen()`.
 *
 * The web counterpart is `apps/web/src/components/MyKitchen.tsx` and the
 * feature is BL-0043: a plain set of toggles over the curated catalog, because
 * inferring what someone owns from what they have cooked cannot tell "doesn't
 * own it" from "hasn't cooked it".
 *
 * Ticking something opens its unlocks in place — telling the app what you own
 * is a chore, so the payoff arrives in the same breath. Web lays the catalog
 * out two-up; a phone gets one full-width row per device, because these are the
 * targets a user taps twenty of in a row.
 */
import { equipmentName } from "@pantry/core";
import { useMyKitchen } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { KitchenUnlocks } from "./KitchenUnlocks";

const id = surfaceTestIDs("recipes");

export function MyKitchen() {
  const {
    catalog,
    groups,
    ownedCount,
    isOwned,
    loading,
    inventoryLoading,
    catalogError,
    error,
    setOwned,
  } = useMyKitchen();

  // Which device's unlocks are on screen. Set by ticking a box (the discovery
  // moment) and by the per-row button, so it can be revisited later.
  const [spotlight, setSpotlight] = useState<string | null>(null);

  function toggle(equipmentId: string, next: boolean) {
    // The write is optimistic, so the unlocks open against a kitchen that
    // already contains the device rather than waiting a round trip.
    setSpotlight(next ? equipmentId : (current) => (current === equipmentId ? null : current));
    setOwned(equipmentId, next);
  }

  return (
    <View className="gap-3" testID={id("kitchen")}>
      <Text className="text-sm text-muted">
        Tick what you cook with. We'll flag recipes you're missing equipment for — and show you what
        a new gadget unlocks.
      </Text>

      {loading && catalog.length === 0 && (
        <Text className="text-sm text-muted" testID={id("kitchen-loading")}>
          Loading equipment…
        </Text>
      )}
      {catalogError !== null && (
        <Text className="text-sm text-danger" testID={id("kitchen-error")}>
          {catalogError}
        </Text>
      )}
      {error !== null && (
        <Text className="text-sm text-danger" testID={id("kitchen-write-error")}>
          {error}
        </Text>
      )}

      {spotlight !== null && (
        <KitchenUnlocks
          equipmentId={spotlight}
          name={equipmentName(catalog, spotlight)}
          onDismiss={() => setSpotlight(null)}
        />
      )}

      {/* Not rendered until the inventory has answered: "nothing in your kitchen
          yet" is a claim, and making it during the first round trip is wrong. */}
      {!inventoryLoading && catalog.length > 0 && (
        <Text className="text-xs text-muted" testID={id("kitchen-count")}>
          {ownedCount === 0
            ? "Nothing in your kitchen yet."
            : `${ownedCount} of ${catalog.length} in your kitchen.`}
        </Text>
      )}

      {groups.map((group) => (
        <View className="gap-2" key={group.category}>
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
            {group.label}
          </Text>
          {group.items.map((item) => {
            const owned = isOwned(item.id);
            return (
              <View className="flex-row items-center gap-2" key={item.id}>
                <Pressable
                  accessibilityLabel={item.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: owned }}
                  className={`flex-1 flex-row items-center justify-between rounded-lg border px-3 ${
                    owned ? "border-primary bg-primary/10" : "border-border bg-surface"
                  }`}
                  onPress={() => toggle(item.id, !owned)}
                  style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                  testID={TEST_IDS.recipes.equipment(item.id)}
                >
                  <Text className="text-base text-text">{item.name}</Text>
                  <Text
                    className={`text-sm font-semibold ${owned ? "text-primary" : "text-muted"}`}
                  >
                    {owned ? "Owned" : "Add"}
                  </Text>
                </Pressable>
                {owned && spotlight !== item.id && (
                  <Pressable
                    accessibilityLabel={`What can I make with my ${item.name}?`}
                    accessibilityRole="button"
                    className="items-center justify-center rounded-full border border-border px-3"
                    onPress={() => setSpotlight(item.id)}
                    style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                    testID={TEST_IDS.recipes.unlocks(item.id)}
                  >
                    <Text className="text-sm text-muted">What now?</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
