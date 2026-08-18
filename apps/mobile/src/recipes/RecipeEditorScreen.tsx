/**
 * The add funnel and the edit form, native — one screen (BL-0020, BL-0063).
 *
 * The UX plan's rule is that every path producing a recipe ends at the same
 * editable review surface, and that a parse is NEVER saved silently. So the URL
 * box here imports *into the fields below*; nothing is written until Save. That
 * is also why this is one component with a `recipeId` rather than a create
 * screen and an edit screen — the moment they are two, one of them quietly
 * stops rendering a field and starts dropping it on save.
 *
 * Presentation over `useRecipeEditor()`. Importing on a phone is the case that
 * earns this screen: a link arrives in a message, and this is where it lands.
 */
import { useRecipeEditor } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { colorTokens } from "@pantry/design-tokens";
import { useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { RecipeFields } from "./RecipeFields";

const id = surfaceTestIDs("recipes");

export function RecipeEditorScreen({ recipeId }: { recipeId?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const editor = useRecipeEditor(recipeId);
  const {
    draft,
    equipment,
    derivedPrep,
    loading,
    missing,
    loadError,
    importing,
    importError,
    importRecipe,
    canSave,
    saving,
    error,
    save,
    setCuisine,
    setEquipment,
    setIngredients,
    setMethods,
    setPrepTasks,
    setServings,
    setSteps,
    setTags,
    setTitle,
    setTotalMinutes,
    setUrl,
  } = editor;

  const creating = editor.mode === "create";

  async function onSave() {
    // Back, not forward: the recipe you just saved is behind you on the list
    // you came from, and pushing a third screen would leave two to dismiss.
    if ((await save()) !== null) router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-bg"
      testID={id("editor")}
    >
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-16"
        contentContainerStyle={{ paddingTop: insets.top + 8 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {/* The stack renders no header (`headerShown: false` at the root), so
            the screen owns its own way back. */}
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="self-start rounded-full border border-border px-4 py-2.5"
          onPress={() => router.back()}
          testID={id("editor-back")}
        >
          <Text className="text-sm font-medium text-muted">← Back</Text>
        </Pressable>

        <Text className="text-2xl font-semibold text-text" testID={id("editor-title")}>
          {creating ? "Add a recipe" : "Edit recipe"}
        </Text>

        {loading && (
          <Text className="text-base text-muted" testID={id("editor-loading")}>
            Loading the recipe…
          </Text>
        )}

        {missing && (
          <Text className="text-base text-muted" testID={id("editor-missing")}>
            This recipe is no longer in your library.
          </Text>
        )}

        {loadError !== null && (
          <Text className="text-base text-danger" testID={id("editor-load-error")}>
            {loadError}
          </Text>
        )}

        {/* Import is offered only when creating. Re-importing over an edit would
            silently overwrite the corrections that are the point of this screen. */}
        {creating && (
          <View className="gap-2" testID={id("import")}>
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
              Import from a link
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                accessibilityLabel="Recipe URL"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 rounded-lg border border-border bg-surface px-3 text-base text-text"
                inputMode="url"
                onChangeText={setUrl}
                placeholder="Paste a recipe URL…"
                placeholderTextColor={colorTokens.muted}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={TEST_IDS.recipes.importUrl}
                value={draft.url}
              />
              <Pressable
                accessibilityLabel="Import this recipe"
                accessibilityRole="button"
                accessibilityState={{ disabled: importing || draft.url.trim() === "" }}
                className={`items-center justify-center rounded-lg px-4 ${
                  importing || draft.url.trim() === "" ? "bg-border" : "bg-primary"
                }`}
                disabled={importing || draft.url.trim() === ""}
                onPress={() => void importRecipe()}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={TEST_IDS.recipes.importSubmit}
              >
                <Text
                  className={`text-base font-medium ${
                    importing || draft.url.trim() === "" ? "text-muted" : "text-surface"
                  }`}
                >
                  {importing ? "Importing…" : "Import"}
                </Text>
              </Pressable>
            </View>
            <Text className="text-xs text-muted">
              Nothing is saved until you check it over and tap Save.
            </Text>
            {importError !== null && (
              <Text className="text-sm text-danger" testID={id("import-error")}>
                {importError}
              </Text>
            )}
          </View>
        )}

        {!missing && (
          <RecipeFields
            derivedPrep={derivedPrep}
            draft={draft}
            equipment={equipment}
            onChangeCuisine={setCuisine}
            onChangeEquipment={setEquipment}
            onChangeIngredients={setIngredients}
            onChangeMethods={setMethods}
            onChangePrepTasks={setPrepTasks}
            onChangeServings={setServings}
            onChangeSteps={setSteps}
            onChangeTags={setTags}
            onChangeTitle={setTitle}
            onChangeTotalMinutes={setTotalMinutes}
          />
        )}

        {error !== null && (
          <Text className="text-sm text-danger" testID={id("editor-error")}>
            {error}
          </Text>
        )}

        {!missing && (
          <Pressable
            accessibilityLabel={creating ? "Create this recipe" : "Save this recipe"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave || saving }}
            className={`items-center justify-center rounded-xl px-4 ${
              !canSave || saving ? "bg-border" : "bg-primary"
            }`}
            disabled={!canSave || saving}
            onPress={() => void onSave()}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={TEST_IDS.recipes.saveRecipe}
          >
            <Text
              className={`text-base font-semibold ${!canSave || saving ? "text-muted" : "text-surface"}`}
            >
              {saving ? "Saving…" : creating ? "Create recipe" : "Save"}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
