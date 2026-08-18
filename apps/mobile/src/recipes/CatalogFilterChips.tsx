/**
 * The catalog's filter chips, native (BL-0020 on a phone).
 *
 * Which recipes a selection matches, and which chips are worth offering at all,
 * come from `@pantry/core` — this file is the chip row and nothing else, the
 * same split the web `CatalogFilters` makes. Cook time leads because it is the
 * #1 weeknight filter.
 *
 * The rows wrap rather than scroll horizontally: a chip half off the edge of a
 * phone is a chip nobody presses, and there are at most a handful per group.
 */
import { COOK_TIME_BUCKETS, type CatalogFilter, humanizeSlug } from "@pantry/core";
import { TEST_IDS } from "@pantry/core/testing";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";

const id = surfaceTestIDs("recipes");

export function CatalogFilterChips({
  filter,
  cuisines,
  diets,
  onToggleCookTime,
  onToggleCuisine,
  onToggleDiet,
}: {
  filter: CatalogFilter;
  /** The cuisines the loaded catalog actually holds. */
  cuisines: string[];
  /** The diet tags the loaded catalog can satisfy. */
  diets: string[];
  onToggleCookTime: (id: NonNullable<CatalogFilter["cookTime"]>) => void;
  onToggleCuisine: (cuisine: string) => void;
  onToggleDiet: (diet: string) => void;
}) {
  return (
    <View className="gap-2" testID={id("filters")}>
      <ChipRow legend="Cook time">
        {COOK_TIME_BUCKETS.map((bucket) => (
          <Chip
            key={bucket.id}
            label={bucket.label}
            onPress={() => onToggleCookTime(bucket.id)}
            selected={filter.cookTime === bucket.id}
            testID={TEST_IDS.recipes.catalogChip("time", bucket.id)}
          />
        ))}
      </ChipRow>

      {diets.length > 0 && (
        <ChipRow legend="Diet">
          {diets.map((diet) => (
            <Chip
              key={diet}
              label={humanizeSlug(diet)}
              onPress={() => onToggleDiet(diet)}
              selected={filter.diets.includes(diet)}
              testID={TEST_IDS.recipes.catalogChip("diet", diet)}
            />
          ))}
        </ChipRow>
      )}

      {cuisines.length > 0 && (
        <ChipRow legend="Cuisine">
          {cuisines.map((cuisine) => (
            <Chip
              key={cuisine}
              label={humanizeSlug(cuisine)}
              onPress={() => onToggleCuisine(cuisine)}
              selected={filter.cuisines.includes(cuisine)}
              testID={TEST_IDS.recipes.catalogChip("cuisine", cuisine)}
            />
          ))}
        </ChipRow>
      )}
    </View>
  );
}

function ChipRow({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">{legend}</Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

function Chip({
  label,
  onPress,
  selected,
  testID,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`items-center justify-center rounded-full border px-3 ${
        selected ? "border-transparent bg-text" : "border-border bg-surface"
      }`}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-sm font-medium ${selected ? "text-surface" : "text-muted"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
