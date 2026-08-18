/**
 * Adding something the plan did not ask for (BL-0019).
 *
 * A grocery list that only holds what the meal planner derived is not a grocery
 * list — foil, coffee and dish soap never come from a recipe. One field, not
 * three: in an aisle you type "2 lb butter", and `parseManualEntry` — reached
 * through `useGroceryList().addManual` — splits it back apart. Nothing is
 * parsed here; the field hands over the raw text.
 *
 * The chips are what this household actually buys, which makes the common case
 * one tap and no typing at all. That matters more here than on web: typing on a
 * phone with one hand, in a shop, is the slowest thing this app can ask for.
 */

import type { RecentItem } from "@pantry/core/data";
import { colorTokens } from "@pantry/design-tokens";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("list");

export function AddItemField({
  recent,
  onAdd,
}: {
  recent: readonly RecentItem[];
  /** Takes the raw text. Parsing it is the data layer's job, not the field's. */
  onAdd: (typed: string) => void;
}) {
  const [text, setText] = useState("");

  function add(raw: string) {
    // Cleared optimistically: the field is the fastest thing on screen, and
    // waiting for a round trip to empty it makes double-adds feel likely.
    setText("");
    onAdd(raw);
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 rounded-lg border border-border bg-surface px-3 text-base text-text"
          onChangeText={setText}
          // Submitting from the keyboard means never reaching for the button,
          // which is the whole reason the field is one field.
          onSubmitEditing={() => add(text)}
          placeholder="Add an item — e.g. 2 lb butter"
          placeholderTextColor={colorTokens.muted}
          returnKeyType="done"
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("add-field")}
          value={text}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: text.trim() === "" }}
          className={`items-center justify-center rounded-lg px-4 ${
            text.trim() === "" ? "bg-border" : "bg-primary"
          }`}
          disabled={text.trim() === ""}
          onPress={() => add(text)}
          style={{ minHeight: CONTROL_TARGET_HEIGHT }}
          testID={id("add-submit")}
        >
          <Text
            className={`text-base font-medium ${
              text.trim() === "" ? "text-muted" : "text-surface"
            }`}
          >
            Add
          </Text>
        </Pressable>
      </View>
      {recent.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {recent.map((suggestion) => (
            <Pressable
              accessibilityRole="button"
              className="items-center justify-center rounded-full bg-border px-3"
              key={suggestion.canonicalItem}
              onPress={() => add(suggestion.display)}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("add-suggestion", testIDKey(suggestion.display))}
            >
              <Text className="text-sm text-text">{suggestion.display}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
