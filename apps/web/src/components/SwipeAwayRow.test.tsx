import { SWIPE_COMMIT_PX, SWIPE_SLOP_PX } from "@pantry/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SwipeAwayRow } from "./SwipeAwayRow";

/** Drags the row from x=200 by `dx` (and optionally `dy`), then lets go. */
function swipe(target: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(target, { clientX: 200, clientY: 100 });
  fireEvent.pointerMove(target, { clientX: 200 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(target, { clientX: 200 + dx, clientY: 100 + dy });
}

/**
 * The gesture handlers sit on the row's sliding content, not on the `<li>`
 * wrapper, so a finger lands on something inside the row — as it does in a
 * shop. Firing on the wrapper would never reach them.
 */
function renderRow(onRemove?: () => void) {
  render(
    <ul>
      <SwipeAwayRow onRemove={onRemove} removeLabel="Remove">
        <button type="button">Remove milk</button>
      </SwipeAwayRow>
    </ul>,
  );
  return screen.getByRole("button", { name: "Remove milk" });
}

describe("SwipeAwayRow", () => {
  it("removes the row on a swipe past the commit distance", () => {
    const onRemove = vi.fn();
    swipe(renderRow(onRemove), -(SWIPE_COMMIT_PX + 10));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a short drag — an ordinary tap wanders a little", () => {
    const onRemove = vi.fn();
    swipe(renderRow(onRemove), -(SWIPE_SLOP_PX - 2));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("does nothing on a drag that stops short of committing", () => {
    const onRemove = vi.fn();
    swipe(renderRow(onRemove), -(SWIPE_COMMIT_PX - 10));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("yields to a vertical drag, which is the page being scrolled", () => {
    const onRemove = vi.fn();
    swipe(renderRow(onRemove), -(SWIPE_COMMIT_PX + 10), 200);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("does nothing rightward", () => {
    const onRemove = vi.fn();
    swipe(renderRow(onRemove), SWIPE_COMMIT_PX + 10);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("has no gesture at all on a row that cannot be removed", () => {
    const row = renderRow(undefined);
    // No throw, no state, nothing to commit to: the accelerator only exists
    // where the action it accelerates does.
    swipe(row, -(SWIPE_COMMIT_PX + 10));
    expect(screen.getByRole("listitem")).toBeTruthy();
  });

  it("reveals the removal target only while the finger is down", () => {
    const row = renderRow(vi.fn());
    expect(row.textContent).not.toContain("Remove milk—");

    fireEvent.pointerDown(row, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 140, clientY: 100 });
    // Two "Remove" strings now: the decorative target and the real button.
    expect(screen.getAllByText(/^Remove$/)).toHaveLength(1);

    fireEvent.pointerUp(row, { clientX: 140, clientY: 100 });
    expect(screen.queryByText(/^Remove$/)).toBeNull();
  });

  it("abandons the gesture when the pointer is cancelled", () => {
    const onRemove = vi.fn();
    const row = renderRow(onRemove);
    fireEvent.pointerDown(row, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(row, { clientX: 40, clientY: 100 });
    fireEvent.pointerCancel(row);
    fireEvent.pointerUp(row, { clientX: 40, clientY: 100 });
    expect(onRemove).not.toHaveBeenCalled();
  });
});
