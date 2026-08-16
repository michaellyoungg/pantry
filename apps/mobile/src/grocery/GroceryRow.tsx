/**
 * One line of the grocery list, as a native row.
 *
 * The layout is the whole point of this file. Web puts the check-off label and
 * every secondary control on one line; that is right for a pointer and wrong
 * for a thumb, because a hand moving with a trolley mis-aims *along* the row
 * and lands on whatever is next to what it meant.
 *
 * So the row is two bands:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ [✓]  2 bunches Parsley                     │  the check-off target, and
 *   │      needs 6 tbsp                          │  the only thing in this band
 *   ├────────────────────────────────────────────┤
 *   │      2 recipes · already have · Need it    │  small, deliberate, chips
 *   └────────────────────────────────────────────┘
 *
 * Every stray tap in the top band therefore lands on check-off, which is its
 * own inverse — a second tap undoes it. Nothing that needs a *different* action
 * to undo it (remove, "need it anyway") is reachable by a mis-aim.
 *
 * No domain logic lives here: what to buy and what the recipes needed both come
 * from `purchaseText` in `@pantry/core`, which is the same call the web row
 * makes, and quantities are formatted by `formatQuantity`.
 */
import { formatQuantity, type PurchasedLine, purchaseText } from "@pantry/core";
import { colorTokens } from "@pantry/design-tokens";
import Check from "lucide-react-native/icons/check";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { CHIP_HIT_SLOP, ROW_PRESS_PROPS } from "./hitTargets";

const id = surfaceTestIDs("list");

/** Only what the row draws — deliberately not the Convex document type. */
export type GroceryRowLine = PurchasedLine & {
  _id: string;
  item: string;
  checked: boolean;
  alreadyHave?: boolean;
  manual?: boolean;
  sources?: readonly { recipeId: string; title: string; quantity: number }[];
};

/** A small secondary action. Drawn quiet, hit-slopped so it is still reachable. */
function Chip({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className="rounded-full bg-border px-3 py-1"
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      testID={testID}
    >
      <Text className="text-xs text-text">{label}</Text>
    </Pressable>
  );
}

export function GroceryRow({
  line,
  onToggle,
  onOpenSources,
  onRemove,
  onNeedItAnyway,
  leaving = false,
  highlighted = false,
}: {
  line: GroceryRowLine;
  onToggle: (checked: boolean) => void;
  onOpenSources: () => void;
  /** Absent when this line cannot be removed — a generated one comes back. */
  onRemove?: () => void;
  onNeedItAnyway?: () => void;
  /** Ticked, and still animating out of the walk. */
  leaving?: boolean;
  /** Another shopper in this household just changed it. */
  highlighted?: boolean;
}) {
  const key = testIDKey(line.item);
  const { buy, need } = purchaseText(line, formatQuantity);
  const sources = line.sources ?? [];
  const hasChips = sources.length > 0 || line.alreadyHave === true || onRemove !== undefined;

  return (
    <View
      className={`mb-1 rounded-lg ${highlighted ? "bg-primary/10" : "bg-surface"}`}
      style={leaving ? { opacity: 0.5 } : undefined}
      testID={id("item", key)}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.checked }}
        accessibilityLabel={`${buy} ${line.item}`}
        className="flex-row items-center gap-3 px-3"
        onPress={() => onToggle(!line.checked)}
        testID={id("toggle", key)}
        {...ROW_PRESS_PROPS}
      >
        <View
          className={`h-8 w-8 items-center justify-center rounded-md border-2 ${
            line.checked ? "border-primary bg-primary" : "border-border bg-surface"
          }`}
        >
          {line.checked && <Check color={colorTokens.surface} size={20} strokeWidth={3} />}
        </View>
        <View className="flex-1">
          <Text
            className={`text-base ${
              line.checked
                ? "text-muted line-through"
                : line.alreadyHave
                  ? "text-muted"
                  : "text-text"
            }`}
            testID={id("buy", key)}
          >
            {buy} {line.item}
          </Text>
          {/* What the recipes asked for, kept only when it differs from the
              pack — otherwise the line says the same thing twice. */}
          {need !== undefined && (
            <Text className="text-xs text-muted" testID={id("need", key)}>
              needs {need}
            </Text>
          )}
        </View>
      </Pressable>

      {hasChips && (
        <View className="flex-row flex-wrap items-center gap-2 px-3 pb-2 pl-14">
          {sources.length > 0 && (
            <Chip
              label={`${sources.length} ${sources.length === 1 ? "recipe" : "recipes"}`}
              onPress={onOpenSources}
              testID={id("provenance", key)}
            />
          )}
          {line.alreadyHave === true && (
            <>
              <Text className="text-xs text-muted" testID={id("already-have", key)}>
                already have
              </Text>
              {onNeedItAnyway && (
                <Chip
                  label="Need it anyway"
                  onPress={onNeedItAnyway}
                  testID={id("need-it-anyway", key)}
                />
              )}
            </>
          )}
          {onRemove && <Chip label="Remove" onPress={onRemove} testID={id("remove", key)} />}
        </View>
      )}
    </View>
  );
}
