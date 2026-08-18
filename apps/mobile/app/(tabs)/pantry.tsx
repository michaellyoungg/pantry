/**
 * The pantry route, native (BL-0059) — the in-kitchen half of the loop the
 * grocery screen starts. Check-off inflow (BL-0021) lands here, expiry nudges
 * surface here (BL-0029), and this is where "use it up" lives (BL-0050).
 *
 * Composition mirrors `apps/web/src/routes/pantry.tsx`: ONE suggestion card
 * above the inventory. That page used to render two — an expiry-driven one and
 * a preference-driven one, with overlapping results and different filtering
 * rules — and `variant="page"` is what makes this one show even when nothing is
 * expiring: this screen is the feature's home, whereas on Home it is an
 * interrupt.
 */
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PantryInventory } from "../../src/pantry/PantryInventory";
import { UseItUpCard } from "../../src/pantry/UseItUpCard";
import { surfaceTestIDs } from "../../src/testing/testIDs";

const id = surfaceTestIDs("pantry");

export default function PantryScreen() {
  // The tab navigator renders no header (`headerShown: false`), so the screen
  // owns its own top inset; without this the title sits under the status bar.
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-2xl font-semibold text-text" testID={id("title")}>
          Pantry
        </Text>
        <UseItUpCard variant="page" />
        <PantryInventory />
      </ScrollView>
    </View>
  );
}
