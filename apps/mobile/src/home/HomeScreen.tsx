/**
 * The home dashboard, native (BL-0062).
 *
 * On the web this route competes with a sidebar that is always on screen. On a
 * phone it is the launch screen: the first thing seen after unlocking, and the
 * only surface that answers "what do I do now?" before the user has decided
 * where to go. It therefore carries more weight here than it does there.
 *
 * Presentation over `useHome()` and nothing else. Which of the five states the
 * week is in, the seven day buckets, and the build-list action all come from
 * `@pantry/core/data`; the web dashboard renders from the same hook, so the
 * two clients cannot come to different conclusions about the same account.
 *
 * What is native is the ordering and the navigation. Routing lives here rather
 * than in the cards below — rule 5 of the parity plan keeps routers out of
 * shared code, and it keeps every card testable without a router.
 */
import type { NavRoute } from "@pantry/core";
import { useHome } from "@pantry/core/data";
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BeforeYouCook } from "../cooking/BeforeYouCook";
import { recipeHref, tabHref } from "../navigation/navItems";
import { UseItUpCard } from "../pantry/UseItUpCard";
import { surfaceTestIDs } from "../testing/testIDs";
import { GettingStarted } from "./GettingStarted";
import { NextAction } from "./NextAction";
import { QuickActions } from "./QuickActions";
import { WeekStrip } from "./WeekStrip";

const id = surfaceTestIDs("home");

export function HomeScreen() {
  // The tab navigator renders no header (`headerShown: false`), so the screen
  // owns its own top inset; without this the title sits under the status bar.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, days, unscheduled, pending, error, buildList } = useHome();

  const open = (route: NavRoute) => router.navigate(tabHref(route));
  const openRecipe = (recipeId: string) => router.navigate(recipeHref(recipeId));

  // Building from Home saves a hop through the planner on the most common
  // weekly action; on success we land on the list, ready to shop.
  async function onBuildList() {
    if (await buildList()) open("/list");
  }

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
      >
        <Text className="text-2xl font-semibold text-text" testID={id("title")}>
          Pantry
        </Text>

        <NextAction
          error={error}
          onBuildList={onBuildList}
          onOpenList={() => open("/list")}
          onOpenPlan={() => open("/plan")}
          pending={pending}
          state={state}
        />

        {/* Lead-time prep due today (BL-0042), ported native by BL-0061. It
            sits ABOVE the expiry nudge and directly under the next action for
            the same reason it does on web: it is the only card here that is
            time-critical in a way the user cannot recover from — a thaw missed
            today cannot be made up tomorrow. Renders nothing when nothing is
            due. */}
        <BeforeYouCook />

        {/* The expiry nudge (BL-0029), in its interrupt form: it renders
            nothing unless food is actually about to be wasted, so it never
            competes with the single next action above. It stays the pantry's
            card — one surface, two places it can appear — which is why its
            testIDs are `pantry.*` on this screen too. */}
        <UseItUpCard variant="nudge" />

        <WeekStrip
          days={days}
          onOpenPlan={() => open("/plan")}
          onOpenRecipe={openRecipe}
          unscheduled={unscheduled}
        />

        <QuickActions onOpen={open} />

        <GettingStarted state={state} />
      </ScrollView>
    </View>
  );
}
