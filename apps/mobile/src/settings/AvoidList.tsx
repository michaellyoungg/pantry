/**
 * What the cook refuses, native (BL-0005, BL-0052, BL-0066).
 *
 * The web counterpart is `apps/web/src/components/Preferences.tsx`. Both are
 * presentation over `useAvoidList()`, which owns the part that has to be
 * identical on every client: entries are canonicalized against the ingredient
 * dictionary BEFORE they are stored, and the hook reports what each one
 * resolved to.
 *
 * That report is not decoration. An entry that matched nothing looks exactly
 * like one that matched, and this list REMOVES recipes rather than ranking them
 * lower — so a chip that quietly filters nothing is, for someone who typed an
 * allergen, the worst thing this screen can do. Whatever the hook considers
 * notable is shown; entries that resolved to exactly what was typed say nothing.
 */
import { type AvoidEntry, useAvoidList } from "@pantry/core/data";
import { colorTokens } from "@pantry/design-tokens";
import type { AvoidResolution } from "@pantry/types";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { SettingsSection } from "./SettingsSection";

const id = surfaceTestIDs("settings");

/** What one resolution from the last add has to say for itself. */
function ResolutionNote({
  resolution,
  onAvoidFamily,
}: {
  resolution: AvoidResolution;
  onAvoidFamily: (family: string) => void;
}) {
  const key = testIDKey(resolution.canonicalItem);

  if (resolution.kind === "unknown") {
    return (
      <Text className="text-xs text-danger" testID={id("avoid-note", key)}>
        “{resolution.input}” doesn’t match any ingredient we know, so it won’t remove any recipes.
        Check the spelling, or try a more common name for it.
      </Text>
    );
  }

  if (resolution.kind === "allergen") {
    return (
      <Text className="text-xs text-muted" testID={id("avoid-note", key)}>
        Avoiding {resolution.display} — this also removes recipes with{" "}
        {(resolution.members ?? []).join(", ")}.
      </Text>
    );
  }

  const family = resolution.families?.[0];
  return (
    <View className="gap-1" testID={id("avoid-note", key)}>
      <Text className="text-xs text-muted">
        Avoiding {resolution.display}
        {resolution.display.toLowerCase() !== resolution.input.toLowerCase()
          ? ` (you typed “${resolution.input}”)`
          : ""}
        .
      </Text>
      {/* The nudge to broaden. Kept a separate tappable line rather than text
          with a link in it: RN has no inline anchor, and a whole-line target is
          the right size for a thumb anyway. */}
      {family !== undefined && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onAvoidFamily(family)}
          testID={id("avoid-family", testIDKey(family))}
        >
          <Text className="text-xs text-primary underline">
            Avoid all {family} to cover the whole family
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** One stored entry, labelled with whatever is known about it. */
function AvoidChip({ entry, onRemove }: { entry: AvoidEntry; onRemove: () => void }) {
  const key = testIDKey(entry.canonicalItem);
  const unmatched = entry.kind === "unknown";

  return (
    <View
      className={`flex-row items-center gap-2 rounded-full px-3 py-2 ${
        unmatched ? "bg-danger/10" : "bg-border"
      }`}
      testID={id("avoid-item", key)}
    >
      <View>
        <Text className={`text-sm ${unmatched ? "text-danger" : "text-text"}`}>
          {entry.display}
          {entry.kind === "allergen" ? " · allergen group" : ""}
          {unmatched ? " · matches nothing" : ""}
        </Text>
        {/* Web hides the family members in a tooltip. A phone has no hover, and
            withholding them is not an option — the whole point of a family
            entry is that it removes more than it says — so they are printed. */}
        {entry.kind === "allergen" && entry.members.length > 0 && (
          <Text className="text-xs text-muted" testID={id("avoid-members", key)}>
            Also removes: {entry.members.join(", ")}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityLabel={`Remove ${entry.display}`}
        accessibilityRole="button"
        hitSlop={12}
        onPress={onRemove}
        testID={id("avoid-remove", key)}
      >
        <Text className="text-sm text-muted">✕</Text>
      </Pressable>
    </View>
  );
}

export function AvoidList() {
  const { entries, notes, diets, loading, error, add, applyDiet, remove } = useAvoidList();
  const [draft, setDraft] = useState("");

  function addDraft() {
    const value = draft.trim();
    if (value === "") return;
    setDraft("");
    add([value]);
  }

  return (
    <SettingsSection
      title="Ingredients to avoid"
      description="Recipes with a matching ingredient are removed, not just ranked lower. Each entry is matched to a known ingredient as you add it, and anything we don't recognise is flagged — an entry that matches nothing filters nothing."
    >
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel="Ingredient to avoid"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 rounded-lg border border-border px-3 text-base text-text"
          onChangeText={setDraft}
          onSubmitEditing={addDraft}
          placeholder="Ingredient to avoid"
          placeholderTextColor={colorTokens.muted}
          returnKeyType="done"
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("avoid-input")}
          value={draft}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          className="items-center justify-center rounded-lg border border-border px-4"
          disabled={loading}
          onPress={addDraft}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("avoid-add")}
        >
          <Text className={`text-base font-medium ${loading ? "text-muted" : "text-text"}`}>
            Add
          </Text>
        </Pressable>
      </View>

      {notes.length > 0 && (
        <View className="gap-1" testID={id("avoid-notes")}>
          {notes.map((note) => (
            <ResolutionNote
              key={note.canonicalItem}
              onAvoidFamily={(family) => add([family])}
              resolution={note}
            />
          ))}
        </View>
      )}

      {entries.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {entries.map((entry) => (
            <AvoidChip
              entry={entry}
              key={entry.canonicalItem}
              onRemove={() => remove(entry.canonicalItem)}
            />
          ))}
        </View>
      )}

      <Text className="text-sm text-text">Diet</Text>
      <Text className="text-xs text-muted">
        Picking one fills in the list above, which you can then edit.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {diets.map((diet) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            className="items-center justify-center rounded-full border border-border px-3"
            disabled={loading}
            key={diet}
            // Seeds are resolved by the same path as anything typed, so a seed
            // key that no longer exists is reported rather than stored as a
            // filter that matches nothing.
            onPress={() => applyDiet(diet)}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("diet", testIDKey(diet))}
          >
            <Text className="text-sm text-text">{diet}</Text>
          </Pressable>
        ))}
      </View>

      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("avoid-error")}>
          {error}
        </Text>
      )}
    </SettingsSection>
  );
}
