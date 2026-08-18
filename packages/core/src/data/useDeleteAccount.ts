import { api } from "@pantry/convex/api";
import type { AccountDeletionConfirmation } from "@pantry/types";
import { useAction } from "convex/react";
import { useCallback, useState } from "react";
import { useAsyncAction } from "../react/useAsyncAction";

/**
 * The word the user types to confirm (BL-0068).
 *
 * Annotated rather than inferred: `AccountDeletionConfirmation` is the union
 * `convex/account.ts` proves its own literal against, so if the server ever
 * expects a different word this line stops compiling. Clients read it off the
 * hook instead of writing their own copy — a third spelling of "DELETE" is a
 * button that can never be pressed.
 */
const CONFIRMATION: AccountDeletionConfirmation = "DELETE";

export type UseDeleteAccount = {
  /** The exact word the user has to type. Show it; don't re-spell it. */
  phrase: AccountDeletionConfirmation;
  /** What they have typed so far. */
  typed: string;
  setTyped: (value: string) => void;
  /** True once `typed` matches `phrase` exactly — the delete gate. */
  confirmed: boolean;
  /** True while the cascade is running. It is not instant: it crosses a service. */
  pending: boolean;
  /** A failed deletion. The account is still there; the button can be pressed again. */
  error: string | null;
  /** Delete the account. A no-op until `confirmed`. */
  deleteAccount: () => void;
};

/**
 * Deleting your account, headless (BL-0068).
 *
 * Apple guideline 5.1.1(v) requires this in-app for anything that lets you
 * create an account, so it has to exist on every client — which is exactly why
 * the rule that makes it safe lives here rather than in a screen. What the
 * hook owns is the gate: the confirmation is an EXACT, case-sensitive match, so
 * a client cannot accidentally ship a friendlier "delete" that arms an
 * irreversible action on a slip of the thumb.
 *
 * What it deliberately does not own is the disclosure around it — whether the
 * danger zone starts collapsed, what the sheet looks like, where focus goes.
 * That is per-platform, and `@pantry/core/data`'s contract leaves it to the view.
 *
 * `onDeleted` is where the client signs out. The sessions are already gone
 * server-side by then, but the client still holds a JWT that outlives them, and
 * only the client can clear its own token storage.
 */
export function useDeleteAccount({ onDeleted }: { onDeleted?: () => void } = {}): UseDeleteAccount {
  const remove = useAction(api.account.deleteAccount);
  const { run, error, pending } = useAsyncAction();
  const [typed, setTyped] = useState("");

  const confirmed = typed === CONFIRMATION;

  const deleteAccount = useCallback(() => {
    if (!confirmed) return;
    void run(async () => {
      await remove({ confirmation: CONFIRMATION });
      onDeleted?.();
    });
  }, [confirmed, onDeleted, remove, run]);

  return {
    phrase: CONFIRMATION,
    typed,
    setTyped,
    confirmed,
    pending,
    error,
    deleteAccount,
  };
}
