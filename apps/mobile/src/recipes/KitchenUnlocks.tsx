/**
 * "I just got a panini press — what can I make?", native (BL-0043).
 *
 * Presentation over `useKitchenUnlocks()`. Scoped to what the device *changed*:
 * recipes that were already cookable are excluded server-side, because being
 * told you can now make the roast chicken you have always been able to make is
 * not a discovery.
 *
 * An empty result is a real, common answer — the catalog simply has nothing
 * that needs this device — and is worded as such rather than as a failure.
 */
import { useKitchenUnlocks } from "@pantry/core/data";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("recipes");

export function KitchenUnlocks({
  equipmentId,
  name,
  onDismiss,
}: {
  equipmentId: string;
  /** Display name of the device, for copy. */
  name: string;
  onDismiss: () => void;
}) {
  const { recipes, loading, error, addError, reload, addToBasket } = useKitchenUnlocks(equipmentId);

  return (
    <View
      className="gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4"
      testID={id("unlocks-panel")}
    >
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-base font-semibold text-text">New with your {name}</Text>
        <Pressable
          accessibilityLabel={`Dismiss what's new with your ${name}`}
          accessibilityRole="button"
          className="items-center justify-center rounded-full px-3"
          onPress={onDismiss}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("unlocks-dismiss")}
        >
          <Text className="text-base text-muted">Close</Text>
        </Pressable>
      </View>

      {loading && (
        <Text className="text-sm text-muted" testID={id("unlocks-loading")}>
          Looking for recipes…
        </Text>
      )}

      {error !== null && (
        <View className="gap-2" testID={id("unlocks-error")}>
          <Text className="text-sm text-danger">{error}</Text>
          <Pressable
            accessibilityLabel="Try again"
            accessibilityRole="button"
            className="self-start rounded-xl border border-border px-4 py-3"
            onPress={reload}
            testID={id("unlocks-retry")}
          >
            <Text className="text-base font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && error === null && recipes.length === 0 && (
        <Text className="text-sm text-muted" testID={id("unlocks-empty")}>
          Nothing in your recipes or the catalog needs a {name.toLowerCase()} yet — but it'll show
          up here when something does.
        </Text>
      )}

      {recipes.length > 0 && (
        <Text className="text-sm text-muted" testID={id("unlocks-count")}>
          {recipes.length === 1
            ? "One recipe you couldn't make before:"
            : `${recipes.length} recipes you couldn't make before:`}
        </Text>
      )}

      {recipes.map((recipe) => (
        <View
          className="gap-2 rounded-lg border border-border bg-surface p-3"
          key={recipe.id}
          testID={id("unlocked", testIDKey(recipe.title))}
        >
          <Text className="text-base font-medium text-text">{recipe.title}</Text>
          <Pressable
            accessibilityLabel={`Add ${recipe.title} to the basket`}
            accessibilityRole="button"
            className="items-center justify-center rounded-lg bg-primary px-4"
            onPress={() => addToBasket(recipe)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("unlocked-add", testIDKey(recipe.title))}
          >
            <Text className="text-base font-medium text-surface">Add to basket</Text>
          </Pressable>
        </View>
      ))}

      {addError !== null && (
        <Text className="text-sm text-danger" testID={id("unlocks-add-error")}>
          {addError}
        </Text>
      )}
    </View>
  );
}
