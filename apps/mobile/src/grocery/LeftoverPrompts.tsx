/**
 * "You probably have these left over" — the inferred-leftover prompt (BL-0032).
 *
 * Every row here is a GUESS: we know the typical pack and what the recipes
 * wanted, not what the shop stocked or how heavy the cook's hand was. So each
 * one is answered individually and nothing is written until it is. Auto-adding
 * would corrupt the don't-rebuy signal — the list would quietly stop asking for
 * things the user does not actually have.
 *
 * There is deliberately no "keep all", here as on web: one tap for the whole
 * set would be the frictionless-but-wrong path, and it is the per-item tap that
 * carries the information.
 *
 * The residue arithmetic is `residueText` and `purchaseText` from
 * `@pantry/core` — the same two calls the web prompt makes.
 */
import { formatQuantity, type PurchasedLine, purchaseText, residueText } from "@pantry/core";
import { Pressable, Text, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("list");

/** Only what the prompt draws — deliberately not the Convex document type. */
export type LeftoverRow = PurchasedLine & { _id: string; item: string };

function Answer({
  label,
  onPress,
  testID,
  tone,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tone: "primary" | "quiet";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`flex-1 items-center justify-center rounded-lg px-3 ${
        tone === "primary" ? "bg-primary" : "bg-border"
      }`}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-sm font-medium ${tone === "primary" ? "text-surface" : "text-text"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function LeftoverPrompts<T extends LeftoverRow>({
  proposals,
  onResolve,
}: {
  proposals: readonly T[];
  onResolve: (proposal: T, keep: boolean) => void;
}) {
  if (proposals.length === 0) return null;

  return (
    <View className="mt-4 rounded-lg border border-border bg-surface p-3" testID={id("leftovers")}>
      <Text className="text-xs font-semibold uppercase text-muted">
        You probably have these left over
      </Text>
      <Text className="mt-1 text-xs text-muted">
        Packs are bigger than recipes. Confirm what actually made it home and we will suggest
        recipes that use it up.
      </Text>
      <View className="mt-2 gap-3">
        {proposals.map((row) => {
          const key = testIDKey(row.item);
          const { buy, need } = purchaseText(row, formatQuantity);
          return (
            <View className="gap-2" key={row._id}>
              <Text className="text-sm text-text" testID={id("leftover", key)}>
                <Text className="font-medium">{row.item}</Text>
                <Text className="text-xs text-muted">
                  {" — "}
                  {residueText(row.purchase, formatQuantity)} of the {buy} you bought
                  {need !== undefined && `, after the ${need} your recipes wanted`}
                </Text>
              </Text>
              {/* Two equally weighted answers, side by side and full width: the
                  honest answer is whichever is true, not whichever is easier. */}
              <View className="flex-row gap-2">
                <Answer
                  label="Still have it"
                  onPress={() => onResolve(row, true)}
                  testID={id("leftover-keep", key)}
                  tone="primary"
                />
                <Answer
                  label="All used"
                  onPress={() => onResolve(row, false)}
                  testID={id("leftover-dismiss", key)}
                  tone="quiet"
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
