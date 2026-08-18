/**
 * The end of a shopping trip (BL-0019).
 *
 * A list that is never emptied stops being a list: the next trip starts buried
 * under the last one's ticks. This is the one moment the user gets to say what
 * happens to each half, and the halves genuinely differ:
 *
 *   * what they bought is finished — check-off already put it in the pantry
 *     (BL-0021), so the line has nothing left to say and always goes.
 *   * what they did not buy is an open question. The shop may have been out of
 *     it, or they may have changed their mind. Only they know which.
 *
 * Answered at a till, one-handed, usually while holding something else — so it
 * is a bottom sheet with full-width choices and no small print to aim at.
 */

import type { FinishChoice } from "@pantry/core/data";
import { Text } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";
import { Sheet, SheetButton } from "./Sheet";

const id = surfaceTestIDs("list");

// Re-exported, not redeclared: what the sheet offers and what `useGroceryList`
// sends to `finishShopping` have to be the same union, or the sheet can grow a
// third choice the mutation will reject.
export type { FinishChoice };

export function DoneShoppingSheet({
  inCart,
  stillToBuy,
  unansweredLeftovers,
  onChoose,
  onCancel,
}: {
  inCart: number;
  stillToBuy: number;
  /** Inferred-leftover questions that closing the trip will drop unanswered. */
  unansweredLeftovers: number;
  onChoose: (choice: FinishChoice) => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title="Done shopping?" onClose={onCancel} testID={id("finish-sheet")}>
      <Text className="mt-2 text-sm text-muted" testID={id("finish-in-cart")}>
        {inCart === 1 ? "1 item is" : `${inCart} items are`} in your cart. Checking them off already
        added them to your pantry, so they come off the list either way.
      </Text>
      <Text className="mt-2 text-sm text-muted" testID={id("finish-unbought")}>
        {stillToBuy === 0
          ? "Nothing is left unbought."
          : `${stillToBuy === 1 ? "1 item is" : `${stillToBuy} items are`} still unbought — keep them for the next trip, or clear them too.`}
      </Text>
      {/* Said out loud rather than swallowed: these questions are the only
          record of a pack the user is about to have half of. */}
      {unansweredLeftovers > 0 && (
        <Text className="mt-2 text-sm text-muted" testID={id("finish-leftovers")}>
          {unansweredLeftovers === 1
            ? "1 leftover question"
            : `${unansweredLeftovers} leftover questions`}{" "}
          will close unanswered.
        </Text>
      )}
      <SheetButton
        label="Keep what I didn't buy"
        onPress={() => onChoose("keep")}
        testID={id("finish-keep")}
        tone="primary"
      />
      <SheetButton
        label="Clear the whole list"
        onPress={() => onChoose("remove")}
        testID={id("finish-remove")}
      />
      <SheetButton label="Not yet" onPress={onCancel} testID={id("finish-cancel")} tone="quiet" />
    </Sheet>
  );
}
