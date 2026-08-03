import { useEffect, useId, useRef } from "react";
import { Button } from "./Button";

/**
 * What a confirmation asks. Deliberately data-only — no DOM types, no web
 * specifics — so a native client can hand the same options to `Alert.alert`.
 */
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive (delete, clear, …). */
  destructive?: boolean;
};

/**
 * The web rendering of a confirmation. Prefer `useConfirm()` at call sites —
 * that hook is the portable surface; this component is the part a native
 * client replaces.
 *
 * Built as an explicit overlay rather than `<dialog>.showModal()`: jsdom does
 * not implement `showModal`, so a native modal cannot be exercised in a unit
 * test — and being testable without patching globals is half the point of
 * retiring `window.confirm`.
 */
export function ConfirmDialog({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (answer: boolean) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const restoreFocusTo = useRef<Element | null>(null);
  const {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
  } = options;

  // The dialog takes focus (autoFocus on cancel); hand it back when it goes,
  // so a keyboard user resumes where they left off instead of at <body>.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    return () => {
      const previous = restoreFocusTo.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the key handler is the
    // dialog's own Escape-to-dismiss; focus lives inside it while it is open.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onResolve(false);
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 text-text shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {message && (
          <p id={messageId} className="mt-2 text-sm text-muted">
            {message}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {/* biome-ignore lint/a11y/noAutofocus: focus belongs in a modal the
              moment it opens, and the safe action is the one to land on. */}
          <Button variant="ghost" autoFocus onClick={() => onResolve(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={() => onResolve(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
