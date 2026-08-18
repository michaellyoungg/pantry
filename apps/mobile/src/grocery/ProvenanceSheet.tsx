/**
 * Where an aggregated grocery line came from (BL-0019).
 *
 * A merged line is otherwise opaque: "¾ cup butter" gives no way to tell which
 * of the week's recipes wanted it, so the shopper cannot judge what happens if
 * they skip it or buy less. The sheet answers exactly that.
 *
 * Unlike web, the recipe titles are **not** links. `apps/mobile`'s recipes tab
 * is still a placeholder (BL-0063), and a link that goes to "not ported yet" is
 * worse than no link — it costs a tap and a way back, in a shop. The titles
 * become navigable when there is somewhere to navigate to.
 */
import { formatQuantity } from "@pantry/core";
import { Text, View } from "react-native";
import { Sheet, SheetButton } from "../components/Sheet";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("list");

/** Only what the sheet draws — deliberately not the Convex document type. */
export type ProvenanceSource = { recipeId: string; title: string; quantity: number };

/** Amounts are in the parent line's unit, so they add up to its quantity. */
function amount(quantity: number, unit: string): string {
  return [formatQuantity(quantity), unit].filter(Boolean).join(" ");
}

export function ProvenanceSheet({
  item,
  unit,
  sources,
  onClose,
}: {
  item: string;
  unit: string;
  sources: readonly ProvenanceSource[];
  onClose: () => void;
}) {
  return (
    <Sheet title={item} onClose={onClose} testID={id("provenance-sheet")}>
      <Text className="mt-1 text-sm text-muted">
        {sources.length === 1 ? "From this recipe:" : "Added up from these recipes:"}
      </Text>
      <View className="mt-3 gap-2">
        {sources.map((source) => (
          <View
            className="flex-row items-center justify-between gap-3"
            key={source.recipeId}
            testID={id("provenance-source", testIDKey(source.title))}
          >
            <Text className="flex-1 text-sm text-text">{source.title}</Text>
            <Text className="text-sm text-muted">{amount(source.quantity, unit)}</Text>
          </View>
        ))}
      </View>
      <SheetButton label="Close" onPress={onClose} testID={id("provenance-close")} />
    </Sheet>
  );
}
