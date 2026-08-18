/**
 * "My recipes", native (BL-0063): presentation over `useMyRecipes()`.
 *
 * The web counterpart is `apps/web/src/components/RecipeList.tsx`, and both
 * render the same collection, the same duplicate flag and the same three
 * writes from `@pantry/core/data`.
 *
 * What diverges is what a row IS. On web a row expands in place into the whole
 * recipe, because the list sits on a page with room for it. Here the row is a
 * way in: tapping it opens the recipe screen BL-0061 already built, which is
 * where cooking starts. That is also why deleting asks first — a mis-tap on a
 * phone is far likelier than a mis-click, and this row may be the only copy of
 * a recipe the user typed.
 */
import { formatDuration, humanizeSlug } from "@pantry/core";
import { useMyRecipes } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import type { Recipe } from "@pantry/types";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("recipes");

export function MyRecipes({
  onAdd,
  onEdit,
  onOpen,
}: {
  onAdd: () => void;
  onEdit: (recipeId: string) => void;
  onOpen: (recipeId: string) => void;
}) {
  const { recipes, loading, loadError, error, isDuplicate, addToBasket, remove, reload } =
    useMyRecipes();

  // Which row is mid-confirmation, keyed by recipe id. One at a time: tapping a
  // second Delete moves the prompt rather than opening two.
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <View className="gap-3" testID={id("mine")}>
      <Pressable
        accessibilityLabel="Add a recipe"
        accessibilityRole="button"
        className="items-center justify-center rounded-xl bg-primary px-4"
        onPress={onAdd}
        style={{ minHeight: CONTROL_TARGET_HEIGHT }}
        testID={TEST_IDS.recipes.add}
      >
        <Text className="text-base font-semibold text-surface">Add a recipe</Text>
      </Pressable>

      {/* "Still loading" and "you own nothing" are different answers, and the
          empty copy says which way out of it to take. */}
      {loading && recipes.length === 0 && (
        <Text className="text-sm text-muted" testID={id("mine-loading")}>
          Loading your recipes…
        </Text>
      )}

      {loadError !== null && (
        <View className="gap-2" testID={id("mine-error")}>
          <Text className="text-sm text-danger">{loadError}</Text>
          <Pressable
            accessibilityLabel="Try loading your recipes again"
            accessibilityRole="button"
            className="self-start rounded-xl border border-border px-4 py-3"
            onPress={reload}
            testID={id("mine-retry")}
          >
            <Text className="text-base font-semibold text-text">Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && loadError === null && recipes.length === 0 && (
        <Text className="text-sm text-muted" testID={id("mine-empty")}>
          No recipes yet — import one from a link you were sent, or browse the catalog.
        </Text>
      )}

      {recipes.map((recipe) => (
        <RecipeRow
          confirmingDelete={confirming === recipe.id}
          duplicate={isDuplicate(recipe)}
          key={recipe.id}
          onAskDelete={() => setConfirming(recipe.id)}
          onAddToBasket={() => addToBasket(recipe)}
          onCancelDelete={() => setConfirming(null)}
          onConfirmDelete={() => {
            setConfirming(null);
            void remove(recipe);
          }}
          onEdit={() => onEdit(recipe.id)}
          onOpen={() => onOpen(recipe.id)}
          recipe={recipe}
        />
      ))}

      {error !== null && (
        <Text className="text-sm text-danger" testID={id("mine-write-error")}>
          {error}
        </Text>
      )}
    </View>
  );
}

function RecipeRow({
  confirmingDelete,
  duplicate,
  onAddToBasket,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onEdit,
  onOpen,
  recipe,
}: {
  confirmingDelete: boolean;
  duplicate: boolean;
  onAddToBasket: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  recipe: Recipe;
}) {
  const meta = [
    recipe.totalMinutes === undefined ? undefined : formatDuration(recipe.totalMinutes),
    recipe.cuisine ? humanizeSlug(recipe.cuisine) : undefined,
  ].filter(Boolean);

  return (
    <View
      className="gap-2 rounded-lg border border-border bg-surface p-3"
      testID={TEST_IDS.recipes.item(recipe.title)}
    >
      <Pressable
        accessibilityHint="Opens the recipe"
        accessibilityLabel={recipe.title}
        accessibilityRole="button"
        onPress={onOpen}
        testID={id("open", testIDKey(recipe.title))}
      >
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-base font-medium text-text">{recipe.title}</Text>
          {/* Duplicate titles stay legal (BL-0013). Flagged, not blocked — the
              user prunes them with Edit and Delete. */}
          {duplicate && (
            <Text
              className="rounded-full bg-border px-2 py-0.5 text-xs text-muted"
              testID={id("duplicate", testIDKey(recipe.title))}
            >
              Duplicate
            </Text>
          )}
        </View>
        {meta.length > 0 && <Text className="text-sm text-muted">{meta.join(" · ")}</Text>}
      </Pressable>

      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityLabel={`Add ${recipe.title} to the basket`}
          accessibilityRole="button"
          className="rounded-full border border-border px-3 py-2"
          onPress={onAddToBasket}
          testID={id("basket", testIDKey(recipe.title))}
        >
          <Text className="text-sm font-medium text-text">Add to basket</Text>
        </Pressable>

        <View className="flex-1" />

        {confirmingDelete ? (
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityLabel={`Keep ${recipe.title}`}
              accessibilityRole="button"
              className="rounded-full border border-border px-3 py-2"
              onPress={onCancelDelete}
              testID={id("cancel-delete", testIDKey(recipe.title))}
            >
              <Text className="text-sm text-muted">Keep</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Confirm deleting ${recipe.title}`}
              accessibilityRole="button"
              className="rounded-full border border-danger bg-danger px-3 py-2"
              onPress={onConfirmDelete}
              testID={id("confirm-delete", testIDKey(recipe.title))}
            >
              <Text className="text-sm font-semibold text-surface">Delete</Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityLabel={`Edit ${recipe.title}`}
              accessibilityRole="button"
              className="rounded-full px-3 py-2"
              onPress={onEdit}
              testID={TEST_IDS.recipes.edit(recipe.title)}
            >
              <Text className="text-sm text-muted">Edit</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Delete ${recipe.title}`}
              accessibilityRole="button"
              className="rounded-full px-3 py-2"
              onPress={onAskDelete}
              testID={TEST_IDS.recipes.remove(recipe.title)}
            >
              <Text className="text-sm text-muted">Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
