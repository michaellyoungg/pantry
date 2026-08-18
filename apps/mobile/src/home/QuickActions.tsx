/**
 * The shortcuts under the weekly loop, native (BL-0062).
 *
 * Web offers three; this offers the two whose destinations exist natively.
 * `/recipes/catalog` is not a route in this client yet — it arrives with the
 * recipes browse screen (BL-0063) — and a chip that resolves to nothing is
 * worse than a chip that isn't there. The list is data, so restoring it is one
 * entry.
 */
import type { NavRoute } from "@pantry/core";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("home");

const ACTIONS: readonly { route: NavRoute; label: string }[] = [
  { route: "/recipes", label: "Import a recipe" },
  { route: "/list", label: "Open grocery list" },
];

export function QuickActions({ onOpen }: { onOpen: (route: NavRoute) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2" testID={id("quick-actions")}>
      {ACTIONS.map((action) => (
        <Pressable
          accessibilityLabel={action.label}
          accessibilityRole="button"
          className="rounded-lg border border-border bg-surface px-3.5 py-3"
          key={action.route}
          onPress={() => onOpen(action.route)}
          testID={id("quick-action", testIDKey(action.label))}
        >
          <Text className="text-sm text-text">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
