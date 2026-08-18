/**
 * "Suggest my week", native. Presentation over `useWeekSuggestion()`, which
 * holds the whole proposal in memory until Add is pressed.
 */
import { DAY_FULL, type PlannedItem } from "@pantry/core";
import { useWeekSuggestion } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("plan");

export function SuggestWeekCard({ items }: { items: readonly PlannedItem[] }) {
  const { proposal, thinking, applying, error, suggest, regenerate, dropPick, discard, accept } =
    useWeekSuggestion(items);

  return (
    <View
      className="gap-3 rounded-xl border border-border bg-surface p-4"
      testID={id("suggest-card")}
    >
      <Text className="text-lg font-semibold text-text">Suggest my week</Text>
      <Text className="text-sm text-muted">
        Fill your empty days with dinners that share ingredients — one short shopping list, no two
        nights alike.
      </Text>

      <CardButton
        disabled={thinking}
        label={thinking ? "Thinking…" : proposal ? "Start over" : "Suggest my week"}
        onPress={suggest}
        testID={TEST_IDS.plan.suggest}
        tone="secondary"
      />

      {/* An empty proposal has two very different causes; saying which keeps the
          user from re-pressing a button that cannot help them. */}
      {proposal !== null && proposal.picks.length === 0 && (
        <Text className="text-sm text-muted" testID={id("suggest-empty")}>
          {proposal.lockedWeekdays.length === 7
            ? "Every day is already planned — nothing left to suggest."
            : "No recipes to suggest yet. Add some from the Recipes tab and try again."}
        </Text>
      )}

      {proposal !== null && proposal.picks.length > 0 && (
        <View className="gap-3">
          <View className="gap-1 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Text className="text-sm font-medium text-text" testID={id("suggest-preamble")}>
              A proposed week — nothing is saved until you add it.
            </Text>
            {/* Per-recipe scores explain each dinner; only these explain why
                they belong together, which is why this is one action. */}
            {proposal.setReasons.map((reason) => (
              <Text className="text-sm text-muted" key={reason}>
                {reason}
              </Text>
            ))}
            {proposal.lockedWeekdays.length > 0 && (
              <Text className="text-xs text-muted" testID={id("suggest-locked")}>
                Left alone: {proposal.lockedWeekdays.map((d) => DAY_FULL[d]).join(", ")} — already
                planned.
              </Text>
            )}
          </View>

          {proposal.picks.map((pick) => (
            <View
              className="flex-row items-start gap-3"
              key={pick.recipeId}
              testID={id("suggest-pick", testIDKey(pick.title))}
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-medium text-text">
                  <Text className="text-muted">{DAY_FULL[pick.weekday]}</Text> — {pick.title}
                </Text>
                {pick.reasons.length > 0 && (
                  <Text className="text-xs text-muted">{pick.reasons.slice(0, 2).join(" · ")}</Text>
                )}
                {pick.sharesWith.length > 0 && (
                  <Text className="text-xs text-muted">
                    Shares {pick.sharesWith.slice(0, 3).join(", ")} with the rest of the week
                  </Text>
                )}
                {pick.addsToList.length > 0 && (
                  <Text className="text-xs text-muted">
                    Adds {pick.addsToList.slice(0, 3).join(", ")} to the list
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityLabel={`Not ${pick.title}`}
                accessibilityRole="button"
                className="items-center justify-center rounded-full border border-border px-4"
                disabled={applying}
                onPress={() => dropPick(pick.recipeId)}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={id("suggest-drop", testIDKey(pick.title))}
              >
                <Text className="text-sm text-muted">Not this</Text>
              </Pressable>
            </View>
          ))}

          <CardButton
            disabled={applying}
            label={applying ? "Adding…" : "Add to my week"}
            onPress={accept}
            testID={TEST_IDS.plan.suggestAccept}
            tone="primary"
          />
          <CardButton
            disabled={applying}
            label="Try again"
            onPress={regenerate}
            testID={id("suggest-retry")}
            tone="secondary"
          />
          <CardButton
            disabled={applying}
            label="Discard"
            onPress={discard}
            testID={id("suggest-discard")}
            tone="quiet"
          />
        </View>
      )}

      {error !== null && (
        <Text className="text-sm text-danger" testID={id("suggest-error")}>
          {error}
        </Text>
      )}
    </View>
  );
}

function CardButton({
  disabled,
  label,
  onPress,
  testID,
  tone,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  tone: "primary" | "secondary" | "quiet";
}) {
  const background =
    tone === "primary" ? "bg-primary" : tone === "secondary" ? "border border-border" : "";
  const color = tone === "primary" ? "text-surface" : tone === "quiet" ? "text-muted" : "text-text";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      className={`items-center justify-center rounded-lg px-4 ${background} ${
        disabled ? "opacity-50" : ""
      }`}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-base font-medium ${color}`}>{label}</Text>
    </Pressable>
  );
}
