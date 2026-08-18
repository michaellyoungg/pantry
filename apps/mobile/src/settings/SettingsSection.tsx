/**
 * One block of Settings: a heading, a line saying what the setting does, and
 * the controls.
 *
 * Web wraps each of these in `Card`. There is no native `Card` yet and this is
 * not the item to invent one in — every other native screen writes the same
 * border-and-surface panel inline — so this is that panel with the heading
 * pattern the settings screen repeats five times, and nothing else.
 *
 * The explanatory line is required rather than optional on purpose. Every
 * setting here feeds the recommender, and one that does not say whether it
 * REMOVES recipes or merely reorders them is the confusion BL-0030 exists to
 * prevent.
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("settings");

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const key = testIDKey(title);

  return (
    <View
      className="gap-2 rounded-lg border border-border bg-surface p-4"
      testID={id("section", key)}
    >
      <Text className="text-base font-semibold text-text">{title}</Text>
      <Text className="text-sm text-muted">{description}</Text>
      {children}
    </View>
  );
}
