/**
 * The seeded catalog, native (BL-0063): presentation over `useCatalog()`.
 *
 * The web counterpart is `apps/web/src/components/Catalog.tsx`. Both narrow the
 * same list through the same predicate — the search box, the chips and the
 * equipment filter all live in `@pantry/core/data`, so a phone and a laptop
 * looking at one account see the same recipes.
 *
 * What is native is the density. Web can afford an expanded `<details>` per row
 * while you decide; here a row states the two things that answer "tonight?" —
 * how long it takes and whether this kitchen can make it — and adding is one
 * full-width tap. The recipe itself is a screen away, not inline.
 */
import { FIT_LABELS, formatDuration, humanizeSlug, missingLabel } from "@pantry/core";
import { useCatalog } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { colorTokens } from "@pantry/design-tokens";
import type { EquipmentDef, EquipmentFit, Recipe } from "@pantry/types";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { CatalogFilterChips } from "./CatalogFilterChips";

const id = surfaceTestIDs("recipes");

/**
 * Only `blocked` reaches outside the token palette. `makeable` is the product's
 * primary and `unknown` its border, but "you're missing something" is a warning
 * — and `danger` is already spoken for by destructive actions, so using it here
 * would make two meanings share one colour.
 */
const FIT_STYLE: Record<EquipmentFit["status"], string> = {
  makeable: "border-primary/40 bg-primary/10",
  blocked: "border-amber-500/50 bg-amber-500/10",
  unknown: "border-border bg-border",
};

const FIT_TEXT: Record<EquipmentFit["status"], string> = {
  makeable: "text-primary",
  blocked: "text-amber-700",
  unknown: "text-muted",
};

export function CatalogBrowser() {
  const {
    shown,
    recipes,
    loading,
    loadError,
    error,
    reload,
    filter,
    setQuery,
    toggleCookTime,
    toggleCuisine,
    toggleDiet,
    clearFilter,
    filterActive,
    cuisines,
    diets,
    fits,
    equipment,
    canFilter,
    onlyMakeable,
    setOnlyMakeable,
    hidden,
    added,
    add,
  } = useCatalog();

  return (
    <View className="gap-3" testID={id("catalog")}>
      {loading && recipes.length === 0 && (
        <Text className="text-sm text-muted" testID={id("catalog-loading")}>
          Loading the catalog…
        </Text>
      )}

      {loadError !== null && (
        <View className="gap-2" testID={id("catalog-error")}>
          <Text className="text-sm text-danger">{loadError}</Text>
          <Pressable
            accessibilityLabel="Try loading the catalog again"
            accessibilityRole="button"
            className="self-start rounded-xl border border-border px-4 py-3"
            onPress={reload}
            testID={id("catalog-retry")}
          >
            <Text className="text-base font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && loadError === null && recipes.length === 0 && (
        <Text className="text-sm text-muted" testID={id("catalog-empty")}>
          No catalog recipes yet.
        </Text>
      )}

      {recipes.length > 0 && (
        <>
          <TextInput
            accessibilityLabel="Search the catalog"
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-lg border border-border bg-surface px-3 text-base text-text"
            onChangeText={setQuery}
            placeholder="Search recipes, ingredients or tags…"
            placeholderTextColor={colorTokens.muted}
            returnKeyType="search"
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={TEST_IDS.recipes.catalogSearch}
            value={filter.query}
          />
          <CatalogFilterChips
            cuisines={cuisines}
            diets={diets}
            filter={filter}
            onToggleCookTime={toggleCookTime}
            onToggleCuisine={toggleCuisine}
            onToggleDiet={toggleDiet}
          />
        </>
      )}

      {/* Only offered once we actually know something. Without fits every recipe
          is "unknown", and a filter that hides everything is worse than none. */}
      {canFilter && (
        <View className="gap-1">
          <Pressable
            accessibilityLabel="Only show recipes I can make"
            accessibilityRole="switch"
            accessibilityState={{ checked: onlyMakeable }}
            className={`flex-row items-center justify-between rounded-lg border px-3 ${
              onlyMakeable ? "border-primary bg-primary/10" : "border-border bg-surface"
            }`}
            onPress={() => setOnlyMakeable(!onlyMakeable)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={TEST_IDS.recipes.onlyMakeable}
          >
            <Text className="text-sm text-text">Only show recipes I can make</Text>
            <Text
              className={`text-sm font-semibold ${onlyMakeable ? "text-primary" : "text-muted"}`}
            >
              {onlyMakeable ? "On" : "Off"}
            </Text>
          </Pressable>
          {/* Named, not silently dropped: "unknown" recipes are hidden because
              we cannot vouch for them, and missing data must never look like a
              short catalog. */}
          {onlyMakeable && hidden !== null && (
            <Text className="text-xs text-muted" testID={id("catalog-hidden")}>
              {hidden}
            </Text>
          )}
        </View>
      )}

      {recipes.length > 0 && !canFilter && (
        <Text className="text-xs text-muted" testID={id("catalog-no-kitchen")}>
          Tell us what's in your kitchen and we'll flag the recipes you can make.
        </Text>
      )}

      {recipes.length > 0 && shown.length === 0 && (
        <View className="gap-2" testID={id("catalog-no-matches")}>
          <Text className="text-sm text-muted">
            {canFilter && onlyMakeable
              ? `Nothing here matches your kitchen yet.${hidden === null ? "" : ` ${hidden}`}`
              : "No recipes match these filters."}
          </Text>
          {filterActive && (
            <Pressable
              accessibilityLabel="Clear the filters"
              accessibilityRole="button"
              className="self-start rounded-full border border-border px-4 py-2.5"
              onPress={clearFilter}
              testID={TEST_IDS.recipes.clearFilters}
            >
              <Text className="text-sm font-medium text-text">Clear filters</Text>
            </Pressable>
          )}
        </View>
      )}

      {shown.map((recipe) => (
        <CatalogRow
          added={added.includes(recipe.id)}
          equipment={equipment}
          fit={fits[recipe.id]}
          key={recipe.id}
          onAdd={() => void add(recipe)}
          recipe={recipe}
        />
      ))}

      {error !== null && (
        <Text className="text-sm text-danger" testID={id("catalog-add-error")}>
          {error}
        </Text>
      )}
    </View>
  );
}

function CatalogRow({
  added,
  equipment,
  fit,
  onAdd,
  recipe,
}: {
  added: boolean;
  equipment: EquipmentDef[];
  fit: EquipmentFit | undefined;
  onAdd: () => void;
  recipe: Recipe;
}) {
  const meta = [
    recipe.totalMinutes === undefined ? undefined : formatDuration(recipe.totalMinutes),
    recipe.cuisine ? humanizeSlug(recipe.cuisine) : undefined,
    ...(recipe.tags ?? []).map(humanizeSlug),
  ].filter(Boolean);

  return (
    <View
      className="gap-2 rounded-lg border border-border bg-surface p-3"
      testID={TEST_IDS.recipes.catalogItem(recipe.title)}
    >
      <Text className="text-base font-medium text-text">{recipe.title}</Text>
      {meta.length > 0 && <Text className="text-sm text-muted">{meta.join(" · ")}</Text>}

      {fit !== undefined && (
        <View className="flex-row flex-wrap items-center gap-2">
          <View className={`rounded-full border px-3 py-1 ${FIT_STYLE[fit.status]}`}>
            <Text className={`text-xs font-semibold ${FIT_TEXT[fit.status]}`}>
              {FIT_LABELS[fit.status].label}
            </Text>
          </View>
          {fit.status === "blocked" && fit.missing.length > 0 && (
            <Text className="text-xs text-muted">Needs {missingLabel(equipment, fit.missing)}</Text>
          )}
        </View>
      )}

      {/* Says "Added" rather than going quiet: adding twice is a normal mistake
          on a list you scroll back through, and the clone is idempotent anyway. */}
      <Pressable
        accessibilityLabel={
          added ? `${recipe.title} is already added` : `Add ${recipe.title} to the basket`
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: added }}
        className={`items-center justify-center rounded-lg px-4 ${added ? "bg-border" : "bg-primary"}`}
        disabled={added}
        onPress={onAdd}
        style={{ minHeight: CONTROL_TARGET_HEIGHT }}
        testID={TEST_IDS.recipes.catalogAdd(recipe.title)}
      >
        <Text className={`text-base font-medium ${added ? "text-muted" : "text-surface"}`}>
          {added ? "Added" : "Add to basket"}
        </Text>
      </Pressable>
    </View>
  );
}
