/**
 * The one thing the offline replay cannot decide on its own (BL-0058).
 *
 * Almost every queued check-off replays silently, and should: the shopper
 * already made that decision in the aisle and does not need it read back to
 * them. Two cases cannot be settled that way, and both cost something real if
 * they are swallowed:
 *
 *   * `missing` — the line was hard-deleted by a regeneration that happened
 *     before it ever heard about the check-off. Dropping it loses a purchase
 *     *and* the pantry inflow that purchase should have written, so the next
 *     list asks the shopper to buy something already in their cupboard.
 *   * `superseded` — somebody else decided about that line after this phone
 *     last saw it. Replaying would overwrite a decision made with more
 *     information; not replaying discards the shopper's own tap. Only they can
 *     say which is right.
 *
 * One sheet per conflict, answered in turn, rather than a list with a
 * confirm — each is a separate question about a separate thing, and a bulk
 * "apply all" is how a prompt nobody reads gets built.
 */
import type { ReplayConflict } from "@pantry/core";
import { Text } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";
import { Sheet, SheetButton } from "./Sheet";

const id = surfaceTestIDs("list");

/** What happened, in the shopper's terms rather than the replay's. */
function conflictCopy(conflict: ReplayConflict): { title: string; detail: string } {
  const action = conflict.checked ? "ticked off" : "un-ticked";
  if (conflict.reason === "missing") {
    return {
      title: `${conflict.item} is no longer on your list`,
      detail: `You ${action} it while you were offline, but your list was regenerated before that reached us and this line was dropped. ${
        conflict.checked
          ? "If you did buy it, we can put it back so you can tick it off — which is also what adds it to your pantry."
          : "There is nothing left to un-tick."
      }`,
    };
  }
  return {
    title: `Somebody else changed ${conflict.item}`,
    detail: `You ${action} it while you were offline, but it was changed on another device after that — so we left theirs alone. You can still apply yours.`,
  };
}

export function ReplayConflictSheet({
  conflict,
  onApply,
  onDismiss,
}: {
  conflict: ReplayConflict;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { title, detail } = conflictCopy(conflict);
  // A `missing` line the shopper un-ticked has nothing left to act on: the row
  // is gone and un-ticking a row that does not exist is not an action. Offering
  // a button for it would be offering to do nothing.
  const canApply = conflict.reason === "superseded" || conflict.checked;

  return (
    <Sheet title={title} onClose={onDismiss} testID={id("conflict-sheet")}>
      <Text className="mt-2 text-sm text-muted" testID={id("conflict-detail")}>
        {detail}
      </Text>
      {canApply && (
        <SheetButton
          label={conflict.reason === "missing" ? "Put it back on my list" : "Use mine"}
          onPress={onApply}
          testID={id("conflict-apply")}
          tone="primary"
        />
      )}
      <SheetButton
        label={canApply ? "Leave it" : "Got it"}
        onPress={onDismiss}
        testID={id("conflict-dismiss")}
        tone={canApply ? "quiet" : "primary"}
      />
    </Sheet>
  );
}
