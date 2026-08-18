/**
 * Estimated nutrition for one recipe, native. Presentation over
 * `useRecipeNutrition()`.
 *
 * Every figure here is labelled *estimated* and every panel states its coverage.
 * We estimate the sum of as-purchased ingredients — water loss, drained fat, and
 * "salt to taste" are not modelled — so a confident-looking number would be
 * dishonest. Below the coverage threshold the numbers are suppressed entirely
 * and the missing ingredients are named instead.
 *
 * The panel is collapsed behind a disclosure, which web does not do. A recipe
 * screen a cook opened to cook from leads with the method; fifteen rows of a
 * regulatory label between the ingredients and the steps would bury it. The
 * verdict — the one line most cooks want — stays visible, and the label is one
 * tap away.
 */
import { useRecipeNutrition } from "@pantry/core/data";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { NutritionFactsPanel } from "./NutritionFactsPanel";
import { RecipeGoalFit } from "./RecipeGoalFit";

const id = surfaceTestIDs("recipes");

export function RecipeNutrition({ recipeId }: { recipeId: string }) {
  const { view, loading, error, reload } = useRecipeNutrition(recipeId);
  const [open, setOpen] = useState(false);

  if (loading && !view) {
    return (
      <Text className="py-2 text-sm text-muted" testID={id("nutrition-loading")}>
        Estimating nutrition…
      </Text>
    );
  }

  if (error !== null) {
    return (
      <View className="gap-2 py-2" testID={id("nutrition-error")}>
        <Text className="text-sm text-danger">{error}</Text>
        <Pressable
          accessibilityLabel="Try estimating nutrition again"
          accessibilityRole="button"
          className="items-center justify-center self-start rounded-xl border border-border px-4"
          onPress={reload}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("nutrition-retry")}
        >
          <Text className="text-sm font-medium text-text">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (view === null || view.kind === "empty") return null;

  if (view.kind === "unavailable") {
    return (
      <View className="gap-1 py-2" testID={id("nutrition-unavailable")}>
        <Text className="text-sm text-muted">
          Not enough of this recipe could be identified to estimate its nutrition (about{" "}
          {view.coveragePercent}% accounted for).
        </Text>
        {view.missing.length > 0 && <MissingNote items={view.missing} />}
        {/* Goals still get an answer here — "can't tell" — because the case a
            user most needs told about is the one where we could not measure. */}
        <RecipeGoalFit fit={view.goalFit} />
      </View>
    );
  }

  return (
    <View className="gap-2 py-2" testID={id("nutrition")}>
      {/* The verdict leads: a cook scanning the screen wants "does this fit?"
          before they want fifteen numbers. */}
      <RecipeGoalFit fit={view.goalFit} />

      <Pressable
        accessibilityLabel={open ? "Hide Nutrition Facts" : "Show Nutrition Facts"}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="items-center justify-center self-start rounded-xl border border-border px-4"
        onPress={() => setOpen(!open)}
        style={{ minHeight: CONTROL_TARGET_HEIGHT }}
        testID={id("nutrition-toggle")}
      >
        <Text className="text-sm font-medium text-text">
          {open ? "Hide Nutrition Facts" : "Nutrition Facts"}
        </Text>
      </Pressable>

      {open && (
        <NutritionFactsPanel
          coveragePercent={view.coveragePercent}
          rows={view.rows}
          servingsLabel={view.servingsLabel}
          surface="recipes"
        />
      )}

      {view.missing.length > 0 && <MissingNote items={view.missing} />}
    </View>
  );
}

function MissingNote({ items }: { items: string[] }) {
  return (
    <Text className="text-sm text-muted" testID={id("nutrition-missing")}>
      Not counted: <Text className="text-text">{items.join(", ")}</Text>
    </Text>
  );
}
