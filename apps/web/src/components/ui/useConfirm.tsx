import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmOptions } from "./ConfirmDialog";

export type { ConfirmOptions };

/**
 * Ask the user a yes/no question and await the answer.
 *
 * Replaces `window.confirm`, which only exists on the web, blocks the main
 * thread, cannot be styled, and cannot be exercised in a test without patching
 * a global. `confirm(options) => Promise<boolean>` is the portable surface: a
 * native client keeps the same call sites and backs the hook with `Alert`
 * instead of the `<dialog>` element.
 *
 * Render the returned `confirmDialog` node somewhere in the calling component;
 * it is `null` while no question is outstanding.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOptions(null);
    resolve?.(answer);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A caller must never be left awaiting a promise nothing can settle, so an
    // unanswered question that gets superseded resolves as a "no".
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(next);
    });
  }, []);

  // Same guarantee when the component asking the question goes away.
  useEffect(() => () => resolveRef.current?.(false), []);

  return {
    confirm,
    confirmDialog: options ? <ConfirmDialog options={options} onResolve={settle} /> : null,
  };
}
