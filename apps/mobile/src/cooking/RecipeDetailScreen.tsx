/**
 * Recipe detail, native (BL-0061) — the read side of cooking mode.
 *
 * Presentation over `useRecipeDetail()` from `@pantry/core/data`: the recipe,
 * its derived lead-time prep (BL-0042) and the equipment catalog all come from
 * there, and the labels — cook time, cuisine, tags, methods, prep windows —
 * come from `@pantry/core`. The web counterpart is `RecipeDetails.tsx` plus
 * `RecipePrep.tsx`, rendering the same fields from the same helpers.
 *
 * The composition diverges from web, and that is the point of this screen.
 * There, a recipe is a collapsed `<details>` inside a list of recipes — a
 * reference you expand while deciding. Here it is a whole screen you arrived
 * at because you are about to cook this thing, so it leads with the one action
 * that matters (start cooking) and with what has to have happened already
 * (prep). Ingredients come before the method for the same reason: you check you
 * can make it before you start making it.
 */
import {
  COOKING_METHOD_LABELS,
  formatDuration,
  humanizeSlug,
  PREP_WINDOW_LABELS,
} from "@pantry/core";
import { useRecipeDetail } from "@pantry/core/data";
import type { Ingredient } from "@pantry/types";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cookModeHref } from "../navigation/navItems";
import { RecipeNutrition } from "../nutrition/RecipeNutrition";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { STEP_CONTROL_HEIGHT } from "./legibility";
import { PrepSourceBadge } from "./PrepSourceBadge";

const id = surfaceTestIDs("recipes");

/** One ingredient as a line: "2 tbsp olive oil, warmed". */
function ingredientLine(ing: Ingredient): string {
  const qty = Number.isFinite(ing.quantity) && ing.quantity > 0 ? String(ing.quantity) : "";
  const head = [qty, ing.unit, ing.item].filter(Boolean).join(" ");
  return ing.note ? `${head}, ${ing.note}` : head;
}

/**
 * Show the host, not the full URL: a recipe link is often a paragraph of
 * tracking parameters, and the host is the part that answers "who wrote this?".
 * Falls back to the raw string if it somehow will not parse.
 */
function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function RecipeDetailScreen({ recipeId }: { recipeId: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { recipe, loading, missing, error, prepTasks, prepLoading, equipment, reload } =
    useRecipeDetail(recipeId);

  const steps = recipe?.steps ?? [];
  const tags = recipe?.tags ?? [];
  const methods = recipe?.methods ?? [];

  return (
    <View className="flex-1 bg-bg" testID={id("detail")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-16"
        contentContainerStyle={{ paddingTop: insets.top + 8 }}
      >
        {/* The stack renders no header (`headerShown: false` at the root), so
            the screen owns its own way back. */}
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="self-start rounded-full border border-border px-4 py-2.5"
          onPress={() => router.back()}
          testID={id("back")}
        >
          <Text className="text-sm font-medium text-muted">← Back</Text>
        </Pressable>

        {loading && (
          <Text className="text-base text-muted" testID={id("detail-loading")}>
            Loading the recipe…
          </Text>
        )}

        {/* Distinct from a failure, and stated as a fact rather than an
            apology: the plan can outlive the recipe it points at. */}
        {missing && (
          <Text className="text-base text-muted" testID={id("detail-missing")}>
            This recipe is no longer in your library.
          </Text>
        )}

        {error !== null && (
          <View className="gap-2" testID={id("detail-error")}>
            <Text className="text-base text-danger">{error}</Text>
            <Pressable
              accessibilityLabel="Try loading the recipe again"
              accessibilityRole="button"
              className="self-start rounded-xl border border-border px-4 py-3"
              onPress={reload}
              testID={id("detail-retry")}
            >
              <Text className="text-base font-semibold text-text">Try again</Text>
            </Pressable>
          </View>
        )}

        {recipe !== undefined && (
          <>
            <Text className="text-2xl font-semibold text-text" testID={id("detail-title")}>
              {recipe.title}
            </Text>

            {/* Discovery metadata (BL-0020): what the catalog's chips filter on,
                and what answers "can I cook this tonight?" first. */}
            {(recipe.totalMinutes !== undefined || recipe.cuisine || tags.length > 0) && (
              <Text className="text-sm text-muted" testID={id("detail-meta")}>
                {[
                  recipe.totalMinutes === undefined
                    ? undefined
                    : formatDuration(recipe.totalMinutes),
                  recipe.cuisine ? humanizeSlug(recipe.cuisine) : undefined,
                  tags.length > 0 ? tags.map(humanizeSlug).join(", ") : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}

            {/* The one action this screen exists for. A recipe with no method
                cannot be cooked step by step, so it does not pretend to offer
                it. */}
            {steps.length > 0 && (
              <Pressable
                accessibilityLabel={`Start cooking ${recipe.title}`}
                accessibilityRole="button"
                className="items-center justify-center rounded-xl bg-primary px-4 py-3.5"
                onPress={() => router.navigate(cookModeHref(recipeId))}
                style={{ minHeight: STEP_CONTROL_HEIGHT }}
                testID={id("start-cooking")}
              >
                <Text className="text-base font-semibold text-surface">
                  Start cooking · {steps.length} {steps.length === 1 ? "step" : "steps"}
                </Text>
              </Pressable>
            )}

            {/* Lead-time prep (BL-0042), derived from the recipe rather than
                authored on it. Windows, not dates: a recipe you are reading has
                no cook date, so "the night before" is the only true statement
                available. Check-off lives on Home, where a task belongs to an
                actual dinner. */}
            {prepLoading && (
              <Text className="text-sm text-muted" testID={id("prep-loading")}>
                Checking for prep…
              </Text>
            )}
            {prepTasks.length > 0 && (
              <Section title="Before you start" testID={id("prep")}>
                {prepTasks.map((task) => (
                  <View
                    className="gap-1 border-t border-border py-2"
                    key={task.key}
                    testID={id("prep-task", testIDKey(task.key))}
                  >
                    <Text className="text-base text-text">{task.text}</Text>
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-sm text-muted">
                        {PREP_WINDOW_LABELS[task.window] ?? task.window}
                      </Text>
                      <PrepSourceBadge source={task.source} />
                    </View>
                  </View>
                ))}
              </Section>
            )}

            {recipe.ingredients.length > 0 && (
              <Section title="Ingredients" testID={id("ingredients")}>
                {recipe.ingredients.map((ing) => (
                  <Text
                    className="border-t border-border py-2 text-base text-text"
                    key={`${ing.item}-${ing.unit}-${ing.quantity}`}
                    testID={id("ingredient", testIDKey(ing.item))}
                  >
                    {ingredientLine(ing)}
                  </Text>
                ))}
              </Section>
            )}

            {/* Estimated nutrition (BL-0036, BL-0049) sits under the
                ingredients because that is what it is an estimate of — and
                below the method, which is what the cook came for. */}
            {recipe.ingredients.length > 0 && (
              <Section title="Nutrition" testID={id("nutrition-section")}>
                <RecipeNutrition recipeId={recipeId} />
              </Section>
            )}

            {equipment.length > 0 && (
              <Section title="Equipment" testID={id("equipment")}>
                {equipment.map((e) => (
                  <Text
                    className="border-t border-border py-2 text-base text-text"
                    key={e.id}
                    testID={id("equipment-item", testIDKey(e.id))}
                  >
                    {e.name}
                    {e.required ? "" : " (optional)"}
                  </Text>
                ))}
              </Section>
            )}

            {methods.length > 0 && (
              <Section title="Method" testID={id("methods")}>
                <Text className="py-2 text-base text-text">
                  {methods.map((m) => COOKING_METHOD_LABELS[m] ?? m).join(", ")}
                </Text>
              </Section>
            )}

            {/* The steps in full, for reading before you commit to the
                step-by-step view — which is the same list, one at a time. */}
            {steps.length > 0 && (
              <Section title="Steps" testID={id("steps")}>
                {steps.map((step, index) => (
                  <View
                    className="flex-row gap-3 border-t border-border py-2"
                    // Steps have no identity beyond their position: two lines of
                    // a method can legitimately read identically.
                    // oxlint-disable-next-line react/no-array-index-key -- position IS a step's identity
                    key={index}
                    testID={id("step")}
                  >
                    <Text className="w-6 text-base font-semibold text-muted">{index + 1}</Text>
                    <Text className="flex-1 text-base text-text">{step}</Text>
                  </View>
                ))}
              </Section>
            )}

            {recipe.sourceUrl !== undefined && (
              <Text className="text-sm text-muted" testID={id("detail-source")}>
                From {sourceLabel(recipe.sourceUrl)}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-0" testID={testID}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</Text>
      {children}
    </View>
  );
}
