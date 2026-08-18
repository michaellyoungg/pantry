/**
 * Settings, native (BL-0066).
 *
 * The standing setup the recommender reads: household size, the equipment
 * inventory, the avoid list and tastes. None of it is touched often — these are
 * set-once screens, and that is precisely the argument for porting them. An
 * account configured on the web and then never inspectable on the phone is a
 * confusing product: the phone shows filtered recommendations and offers no way
 * to see, let alone change, what is doing the filtering.
 *
 * Order mirrors `apps/web/src/routes/settings.tsx`. Nutrition goals and My
 * Kitchen are both pointers here, as they are there: each editor lives with the
 * surface it belongs to — goals with the nutrition screens (BL-0065), the
 * inventory in the recipes tab beside the recipes it filters (BL-0063) — and a
 * second copy on Settings is how two surfaces over one thing stop agreeing.
 *
 * Session controls sit at the bottom, and deletion last of all: everything
 * above is something you came here to change, and that is the one thing you
 * cannot change back.
 */
import { useAuthActions } from "@convex-dev/auth/react";
import { Link, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { KITCHEN_HREF, NUTRITION_GOALS_HREF } from "../navigation/navItems";
import { surfaceTestIDs } from "../testing/testIDs";
import { AvoidList } from "./AvoidList";
import { DeleteAccount } from "./DeleteAccount";
import { HouseholdSize } from "./HouseholdSize";
import { KitchenLink } from "./KitchenLink";
import { TastePreferences } from "./TastePreferences";

const id = surfaceTestIDs("settings");

export function SettingsScreen() {
  // The tab navigator renders no header (`headerShown: false`), so the screen
  // owns its own top inset; without this the title sits under the status bar.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuthActions();

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-2xl font-semibold text-text" testID={id("title")}>
          Settings
        </Text>

        {/* First because it is the one setting that changes what the app does
            on the very next tap: the planner seeds each recipe's servings from
            it. */}
        <HouseholdSize />

        <KitchenLink onOpen={() => router.navigate(KITCHEN_HREF)} />

        {/* The goal editor is a screen of its own (BL-0065) — a phone has no
            room to stack it under these cards — so Settings is the way in. */}
        <Link asChild href={NUTRITION_GOALS_HREF}>
          <Pressable
            accessibilityLabel="Nutrition goals"
            accessibilityRole="link"
            className="items-center justify-center rounded-lg border border-border px-4"
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("nutrition-goals")}
          >
            <Text className="text-base text-text">Nutrition goals</Text>
          </Pressable>
        </Link>

        <AvoidList />

        {/* Directly after the avoid list, because the two are constantly
            confused and the contrast is the clearest way to explain either:
            above removes recipes, this only reorders them (BL-0030). */}
        <TastePreferences />

        {/*
          Sign-out landed here ahead of the rest of Settings because without it
          there is no way to leave a session on a device — the simulator's only
          alternative is deleting the app.
        */}
        <Pressable
          accessibilityRole="button"
          className="items-center justify-center rounded-lg border border-border px-4"
          onPress={() => signOut()}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("sign-out")}
        >
          <Text className="text-base text-danger">Sign out</Text>
        </Pressable>

        {/*
          And deletion, for a harder reason than convenience: App Store guideline
          5.1.1(v) requires in-app account deletion from any build that offers
          account creation, so it shipped before the screen it belongs to
          (BL-0068).
        */}
        <DeleteAccount />
      </ScrollView>
    </View>
  );
}
