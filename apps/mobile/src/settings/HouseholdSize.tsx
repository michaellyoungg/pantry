/**
 * How many people this household cooks for (BL-0018), native (BL-0066).
 *
 * The web counterpart is `apps/web/src/components/HouseholdSize.tsx`. Both are
 * presentation over `useHouseholdSizeEditor()`, so the rule that makes this safe —
 * a whole number of people or nothing at all — is one implementation. The
 * number divides into every scaled grocery quantity, and a client that let a
 * fraction through would multiply it across a whole shop before the server
 * refused it.
 *
 * What is native is the keyboard: a numeric pad rather than a spinner, since
 * there is no `<input type="number">` here and a full keyboard for a
 * one-or-two-digit answer is a needless reach.
 */
import { useHouseholdSizeEditor } from "@pantry/core/data";
import { colorTokens } from "@pantry/design-tokens";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs } from "../testing/testIDs";
import { SettingsSection } from "./SettingsSection";

const id = surfaceTestIDs("settings");

export function HouseholdSize() {
  const { value, setValue, invalid, loading, pending, error, save } = useHouseholdSizeEditor();

  return (
    <SettingsSection
      title="Household"
      description="How many people you usually cook for. New recipes start scaled to this; the planner's servings stepper still overrides it per meal."
    >
      {/* An empty field before the query lands is indistinguishable from "you
          have not set this", and one stray keystroke away from overwriting a
          real answer. */}
      {loading ? (
        <Text className="text-sm text-muted" testID={id("household-loading")}>
          Loading…
        </Text>
      ) : (
        <View className="flex-row items-center gap-2">
          <TextInput
            accessibilityLabel="People you cook for"
            className="w-24 rounded-lg border border-border px-3 text-base text-text"
            keyboardType="number-pad"
            onChangeText={setValue}
            // Blank is a real answer — it puts every recipe back on a single
            // batch — so the placeholder is a dash rather than a suggested size.
            placeholder="—"
            placeholderTextColor={colorTokens.muted}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("household-input")}
            value={value}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
            className={`items-center justify-center rounded-lg px-4 ${
              pending ? "bg-border" : "bg-primary"
            }`}
            disabled={pending}
            onPress={save}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("household-save")}
          >
            <Text className={`text-base font-medium ${pending ? "text-muted" : "text-surface"}`}>
              {pending ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      )}

      {invalid && (
        <Text className="text-sm text-danger" testID={id("household-invalid")}>
          Enter a whole number of people, or leave it blank.
        </Text>
      )}
      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("household-error")}>
          {error}
        </Text>
      )}
    </SettingsSection>
  );
}
