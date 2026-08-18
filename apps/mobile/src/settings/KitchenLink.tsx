/**
 * Where the equipment inventory went (BL-0043, BL-0063).
 *
 * A pointer, not a second copy — the same choice `apps/web/src/routes/
 * settings.tsx` makes, for the same reason: the inventory lives with the
 * recipes it filters, but it is standing setup like everything else here, so
 * this is where someone comes looking for it. Two surfaces over one inventory
 * is how the two stop agreeing about what a tick means.
 *
 * Web links to `/recipes/kitchen`. Native has no such route — the kitchen is a
 * segment of the recipes tab — so the destination is `KITCHEN_HREF`, which
 * carries the segment as a parameter.
 */
import { Pressable, Text } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { SettingsSection } from "./SettingsSection";

const id = surfaceTestIDs("settings");

export function KitchenLink({ onOpen }: { onOpen: () => void }) {
  return (
    <SettingsSection
      title="My Kitchen"
      description="Tell us what equipment you own and we'll flag recipes you can't make yet — and show you what a new gadget unlocks."
    >
      <Pressable
        accessibilityRole="button"
        className="items-center justify-center rounded-lg border border-border px-4"
        onPress={onOpen}
        style={{ minHeight: CONTROL_TARGET_HEIGHT }}
        testID={id("open-kitchen")}
      >
        <Text className="text-base font-medium text-primary">Manage your kitchen</Text>
      </Pressable>
    </SettingsSection>
  );
}
