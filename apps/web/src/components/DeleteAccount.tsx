import { useAuthActions } from "@convex-dev/auth/react";
import { useDeleteAccount } from "@pantry/core/data";
import { useId, useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * Close your account and take your data with you (BL-0068).
 *
 * Last on Settings, because everything above it is something you might come to
 * this page to change and this is the one thing you cannot change back.
 *
 * Two steps rather than one, and the second is typed. `useConfirm` would have
 * been the ordinary choice, but a yes/no dialog is one keypress from "yes" —
 * fine for clearing a grocery list, not for the button that ends a plan, a
 * pantry, a year of history and every recipe the user has written. Typing the
 * word is the smallest gesture that cannot be made by accident, and it is the
 * same word the server insists on, read off the hook rather than re-spelled
 * here.
 *
 * Sign-out is the client's own cleanup: the sessions are already gone by the
 * time this resolves, but the browser still holds a JWT that outlives them.
 */
export function DeleteAccount() {
  const { signOut } = useAuthActions();
  const [armed, setArmed] = useState(false);
  const { phrase, typed, setTyped, confirmed, pending, error, deleteAccount } = useDeleteAccount({
    onDeleted: () => void signOut(),
  });
  const fieldId = useId();

  return (
    <Card title="Delete account" label="Delete account">
      <p className="text-sm text-muted">
        Deleting your account removes your recipes, your week plan, your grocery list, your pantry,
        your equipment, your goals and your history — from this app and from the recipe service.
        This cannot be undone and there is no export.
      </p>

      {!armed ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setArmed(true)}>
            Delete my account
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-text" htmlFor={fieldId}>
            Type {phrase} to confirm
            <Input
              id={fieldId}
              className="w-40"
              value={typed}
              autoComplete="off"
              placeholder={phrase}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button variant="danger" disabled={!confirmed || pending} onClick={deleteAccount}>
              {pending ? "Deleting…" : "Delete account"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setTyped("");
                setArmed(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ErrorText message={error} />
    </Card>
  );
}
