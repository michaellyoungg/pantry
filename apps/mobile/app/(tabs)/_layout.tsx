/**
 * The seven tabs, generated from `NAV_ITEMS`, which BL-0054 derives from the
 * shared list in `@pantry/core` — so the bar cannot drift from web.
 */

import { colorTokens } from "@pantry/design-tokens";
import { Tabs } from "expo-router";
import { NAV_ICONS } from "../../src/navigation/navIcons";
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
      {NAV_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        return (
          <Tabs.Screen
            key={item.name}
            name={item.name}
            options={{
              title: item.label,
              tabBarButtonTestID: testID("nav", "tab", item.name === "index" ? "home" : item.name),
              tabBarIcon: ({ color, size }) => (
                <Icon color={color} size={size} strokeWidth={1.75} />
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}
