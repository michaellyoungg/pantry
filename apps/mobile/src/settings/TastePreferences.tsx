/**
 * What the cook likes, native (BL-0030, BL-0066).
 *
 * The web counterpart is `apps/web/src/components/TastePreferences.tsx`. Both
 * are presentation over `useTastePreferences()`: the slugging, the de-dupe and
 * 0-as-"no preference" are shared, so the two clients cannot disagree about
 * what the ranker was told.
 *
 * The copy carries the load here as it does on web. This section only REORDERS
 * recipes, and it sits directly under one that REMOVES them; a cook who reads
 * the two as the same kind of switch stops being shown food they would have
 * enjoyed.
 *
 * What is native is the time limit: web uses a `<select>`, which has no RN
 * equivalent worth emulating, so the four choices are chips. There are four of
 * them and they fit on a phone in two rows, which is a better control than a
 * picker wheel anyway.
 */
import { useTastePreferences } from "@pantry/core/data";
import { colorTokens } from "@pantry/design-tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { SettingsSection } from "./SettingsSection";

const id = surfaceTestIDs("settings");

/** 0 is the wire value for "no opinion" — see `preferences.set`. */
const NO_LIMIT = { label: "No preference", maxMinutes: 0 };

export function TastePreferences() {
  const {
    cuisines,
    maxMinutes,
    buckets,
    loading,
    error,
    addCuisine,
    removeCuisine,
    setMaxMinutes,
  } = useTastePreferences();
  const [draft, setDraft] = useState("");

  function add() {
    // Cleared unconditionally: the hook drops an entry with nothing usable in
    // it, and leaving "!!" in the field would read as if the tap missed.
    setDraft("");
    addCuisine(draft);
  }

  const limits = [NO_LIMIT, ...buckets];

  return (
    <SettingsSection
      title="Tastes"
      description="These rank recipes higher — nothing is removed. A recipe with no cuisine on it stays where it was, so this never buries the recipes you added yourself."
    >
      {/* Nothing may be written against the empty fallback: until the stored
          list is known, adding one cuisine would submit a list that silently
          drops every taste the user already had. */}
      {loading ? (
        <Text className="text-sm text-muted" testID={id("tastes-loading")}>
          Loading…
        </Text>
      ) : (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <TextInput
              accessibilityLabel="Cuisine you like"
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 rounded-lg border border-border px-3 text-base text-text"
              onChangeText={setDraft}
              onSubmitEditing={add}
              placeholder="Thai, Italian, South Indian…"
              placeholderTextColor={colorTokens.muted}
              returnKeyType="done"
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("cuisine-input")}
              value={draft}
            />
            <Pressable
              accessibilityRole="button"
              className="items-center justify-center rounded-lg border border-border px-4"
              onPress={add}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("cuisine-add")}
            >
              <Text className="text-base font-medium text-text">Add</Text>
            </Pressable>
          </View>

          {cuisines.length > 0 && (
            <View className="flex-row flex-wrap gap-2">
              {cuisines.map((cuisine) => (
                <View
                  className="flex-row items-center gap-2 rounded-full bg-border px-3 py-2"
                  key={cuisine.slug}
                  testID={id("cuisine", testIDKey(cuisine.slug))}
                >
                  <Text className="text-sm text-text">{cuisine.label}</Text>
                  <Pressable
                    accessibilityLabel={`Remove ${cuisine.label}`}
                    accessibilityRole="button"
                    // The chip stays chip-sized; `hitSlop` grows what the thumb
                    // has to find without growing the ink.
                    hitSlop={12}
                    onPress={() => removeCuisine(cuisine.slug)}
                    testID={id("cuisine-remove", testIDKey(cuisine.slug))}
                  >
                    <Text className="text-sm text-muted">✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Text className="text-sm text-text">The most time you want to spend</Text>
          <Text className="text-xs text-muted">
            Recipes that fit rank higher, and ones a little over still rank. A recipe with no cook
            time recorded is not treated as a quick one.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {limits.map((limit) => {
              const selected = maxMinutes === limit.maxMinutes;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`items-center justify-center rounded-full border px-3 ${
                    selected ? "border-primary bg-primary/10" : "border-border"
                  }`}
                  key={limit.label}
                  onPress={() => setMaxMinutes(limit.maxMinutes)}
                  style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                  testID={id("time-limit", testIDKey(limit.label))}
                >
                  <Text className={`text-sm ${selected ? "text-primary" : "text-muted"}`}>
                    {limit.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("tastes-error")}>
          {error}
        </Text>
      )}
    </SettingsSection>
  );
}
