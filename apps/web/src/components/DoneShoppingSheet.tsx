import type { FinishChoice } from "@pantry/core/data";
import { useEffect, useId, useRef } from "react";
import { Button } from "./ui/Button";

// Re-exported, not redeclared: what the sheet offers and what `useGroceryList`
// sends to `finishShopping` have to be the same union, or the sheet can grow a
// third choice the mutation will reject.
export type { FinishChoice };

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
 * An explicit overlay rather than `<dialog>.showModal()`, for the reason
 * ConfirmDialog spells out: jsdom does not implement `showModal`, so a native
 * modal cannot be exercised in a unit test. Anchored to the bottom of the
 * screen on a phone — this is reached one-handed at a till.
 */
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
  const titleId = useId();
  const restoreFocusTo = useRef<Element | null>(null);

  // Hand focus back where it came from, so a keyboard user resumes on the
  // control they opened this with rather than at <body>.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    return () => {
      const previous = restoreFocusTo.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full max-w-sm rounded-t-xl border border-border bg-surface p-5 text-text shadow-lg sm:rounded-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Done shopping?
        </h2>
        <p className="mt-2 text-sm text-muted">
          {inCart === 1 ? "1 item is" : `${inCart} items are`} in your cart. Checking them off
          already added them to your pantry, so they come off the list either way.
        </p>
        <p className="mt-2 text-sm text-muted">
          {stillToBuy === 0
            ? "Nothing is left unbought."
            : `${stillToBuy === 1 ? "1 item is" : `${stillToBuy} items are`} still unbought — keep them for the next trip, or clear them too.`}
        </p>
        {/* Said out loud rather than swallowed: these questions are the only
            record of a pack the user is about to have half of. */}
        {unansweredLeftovers > 0 && (
          <p className="mt-2 text-sm text-muted">
            {unansweredLeftovers === 1
              ? "1 leftover question"
              : `${unansweredLeftovers} leftover questions`}{" "}
            will close unanswered.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            autoFocus
            className="min-h-11 w-full"
            onClick={() => onChoose("keep")}
          >
            Keep what I didn't buy
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 w-full"
            onClick={() => onChoose("remove")}
          >
            Clear the whole list
          </Button>
          <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
            Not yet
          </Button>
        </div>
      </div>
    </div>
  );
}
