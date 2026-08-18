/**
 * The recipes tab, native (BL-0063).
 *
 * Web splits this into three sibling routes under `/recipes` with a sub-nav.
 * A phone has no room for a second row of navigation under a tab bar, and the
 * three views are peers over one subject rather than places you go — so they
 * are a segmented control that switches in place. Nothing is pushed, so
 * switching back to My recipes is not a back gesture through the catalog.
 *
 * The screen owns the router and hands its sections callbacks, which is rule 5
 * of the parity plan applied one level down: no section below here can be made
 * untestable by needing a navigator.
 */
import { TEST_IDS } from "@pantry/core/testing";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { editRecipeHref, NEW_RECIPE_HREF, recipeHref } from "../navigation/navItems";
import { surfaceTestIDs } from "../testing/testIDs";
import { CatalogBrowser } from "./CatalogBrowser";
import { MyKitchen } from "./MyKitchen";
import { MyRecipes } from "./MyRecipes";

const id = surfaceTestIDs("recipes");

const SECTIONS = [
  { key: "mine", label: "Mine" },
  { key: "catalog", label: "Catalog" },
  { key: "kitchen", label: "Kitchen" },
] as const;

type Section = (typeof SECTIONS)[number]["key"];

/** A section name off the route, or nothing if it names no segment we have. */
function asSection(value: string | undefined): Section | undefined {
  return SECTIONS.find((tab) => tab.key === value)?.key;
}

export function RecipesScreen({ section: requested }: { section?: string } = {}) {
  // The tab navigator renders no header (`headerShown: false`), so the screen
  // owns its own top inset.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [section, setSection] = useState<Section>(asSection(requested) ?? "mine");

  // The tab stays mounted once visited, so a later "manage your kitchen" from
  // Settings arrives as a changed parameter on a screen that has already picked
  // a segment — the initial state above would never see it. Switching segments
  // by hand afterwards leaves the parameter alone, so this does not fight the
  // control.
  useEffect(() => {
    const wanted = asSection(requested);
    if (wanted !== undefined) setSection(wanted);
  }, [requested]);

  return (
    <View className="flex-1 bg-bg" testID={id("screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-16"
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
        // The catalog's search box and the kitchen's checkboxes are both a long
        // scroll; dismissing the keyboard on drag is what makes them reachable.
        keyboardDismissMode="on-drag"
      >
        <Text className="text-2xl font-semibold text-text" testID={id("title")}>
          Recipes
        </Text>

        <View className="flex-row gap-1 rounded-xl bg-border p-1" testID={id("sections")}>
          {SECTIONS.map((tab) => {
            const active = tab.key === section;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={`flex-1 items-center justify-center rounded-lg ${
                  active ? "bg-surface" : ""
                }`}
                key={tab.key}
                onPress={() => setSection(tab.key)}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={TEST_IDS.recipes.section(tab.key)}
              >
                <Text className={`text-sm font-semibold ${active ? "text-text" : "text-muted"}`}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {section === "mine" && (
          <MyRecipes
            onAdd={() => router.navigate(NEW_RECIPE_HREF)}
            onEdit={(recipeId) => router.navigate(editRecipeHref(recipeId))}
            onOpen={(recipeId) => router.navigate(recipeHref(recipeId))}
          />
        )}
        {section === "catalog" && <CatalogBrowser />}
        {section === "kitchen" && <MyKitchen />}
      </ScrollView>
    </View>
  );
}
