/**
 * The seven tabs, generated from `NAV_ITEMS` so the bar cannot drift from the
 * list the drift test checks against web.
 */

import { colorTokens } from "@pantry/design-tokens";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { NAV_ITEMS } from "../../src/navigation/navItems";
import { testID } from "../../src/testing/testIDs";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colorTokens.primary,
        tabBarInactiveTintColor: colorTokens.muted,
        tabBarStyle: {
          backgroundColor: colorTokens.surface,
          borderTopColor: colorTokens.border,
        },
      }}
    >
      {NAV_ITEMS.map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            title: item.label,
            tabBarButtonTestID: testID("nav", "tab", item.name === "index" ? "home" : item.name),
            tabBarIcon: () => <Text>{item.icon}</Text>,
          }}
        />
      ))}
    </Tabs>
  );
}
