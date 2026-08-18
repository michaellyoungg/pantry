import { trackSwipe } from "@pantry/core";
import type { TestID } from "@pantry/core/testing";
import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

/**
 * A list row that can be swiped left to remove itself (BL-0019).
 *
 * Swipe is an *accelerator*, never the only way to reach the action: every row
 * that can be swiped also carries an ordinary button, because a gesture is
 * invisible, unreachable from a keyboard, and unreliable with a shopping basket
 * in the other hand. A row with no `onRemove` simply has no gesture — there is
 * nothing for it to be an accelerator for.
 *
 * The thresholds live in `@pantry/core` (`trackSwipe`), so what counts as a
 * swipe is decided by two numbers a test can reason about rather than by a
 * pile of DOM state.
 */
export function SwipeAwayRow({
  onRemove,
  removeLabel = "Remove",
  leaving = false,
  highlighted = false,
  testId,
  children,
}: {
  /** Absent when the row cannot be removed — which also disables the gesture. */
  onRemove?: () => void;
  removeLabel?: string;
  /** On its way out to another section; held in place while it animates. */
  leaving?: boolean;
  /** Changed by somebody else just now — flashed so it isn't a silent edit. */
  highlighted?: boolean;
  /** See `Button`'s `testId` — one contract, both clients (BL-0071). */
  testId?: TestID;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const swipeable = onRemove !== undefined;

  function begin(event: ReactPointerEvent) {
    if (!swipeable) return;
    origin.current = { x: event.clientX, y: event.clientY };
  }

  function move(event: ReactPointerEvent) {
    const from = origin.current;
    if (from === null) return;
    setOffset(trackSwipe(event.clientX - from.x, event.clientY - from.y).offset);
  }

  function end(event: ReactPointerEvent) {
    const from = origin.current;
    origin.current = null;
    setOffset(0);
    if (from === null) return;
    if (trackSwipe(event.clientX - from.x, event.clientY - from.y).willDelete) onRemove?.();
  }

  function cancel() {
    origin.current = null;
    setOffset(0);
  }

  return (
    <li
      data-testid={testId}
      className={`relative overflow-hidden rounded-lg ${highlighted ? "grocery-remote" : ""}`}
    >
      {/* What the row slides off to reveal. Decorative — it only exists
          mid-gesture, and the real control is the button inside the row. */}
      {swipeable && offset < 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 flex items-center rounded-lg bg-danger px-4 text-sm font-medium text-white"
        >
          {removeLabel}
        </div>
      )}
      <div
        className={`relative flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface ${
          leaving ? "grocery-leaving" : ""
        }`}
        // Vertical panning stays with the page: a list this long has to scroll.
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          touchAction: swipeable ? "pan-y" : undefined,
        }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
      >
        {children}
      </div>
    </li>
  );
}
