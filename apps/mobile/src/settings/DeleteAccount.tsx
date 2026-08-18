/**
 * Close your account, native (BL-0068).
 *
 * The web counterpart is `apps/web/src/components/DeleteAccount.tsx`. Both are
 * presentation over `useDeleteAccount()` from `@pantry/core/data`, so the gate
 * that makes this safe — an exact, case-sensitive match on the same word the
 * server insists on — is one implementation, not two.
 *
 * It lands here before the rest of Settings is ported for the same reason
 * sign-out did: App Store guideline 5.1.1(v) requires in-app account deletion
 * from any build that lets you create an account, so a native client without it
 * cannot ship at all.
 */
import { useAuthActions } from "@convex-dev/auth/react";
import { useDeleteAccount } from "@pantry/core/data";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";

const id = surfaceTestIDs("settings");

export function DeleteAccount() {
  const { signOut } = useAuthActions();
  const [armed, setArmed] = useState(false);
  const { phrase, typed, setTyped, confirmed, pending, error, deleteAccount } = useDeleteAccount({
    onDeleted: () => void signOut(),
  });

  if (!armed) {
    return (
      <Pressable
        className="mt-2 rounded-lg border border-border px-4 py-3"
        onPress={() => setArmed(true)}
        testID={id("delete-account")}
      >
        <Text className="text-base text-danger">Delete my account</Text>
      </Pressable>
    );
  }

  return (
    <View
      className="mt-2 w-full gap-3 rounded-lg border border-border p-4"
      testID={id("delete-panel")}
    >
      <Text className="text-center text-sm text-muted">
        This removes your recipes, plan, list, pantry, goals and history everywhere. It cannot be
        undone.
      </Text>
      <TextInput
        className="rounded-lg border border-border px-3 py-2 text-base text-text"
        // Autocorrect would "helpfully" rewrite the one string that has to be
        // exact, and the keyboard's capitalisation guess is not the user's.
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={`Type ${phrase} to confirm`}
        value={typed}
        onChangeText={setTyped}
        testID={id("delete-confirm-input")}
      />
      {/* Dimmed while it cannot fire. React Native has no `:disabled`, so an
          unstyled disabled button is one that simply ignores taps — and the
          user has no way to learn that the word has to match. */}
      <Pressable
        className={`items-center rounded-lg px-4 py-3 ${
          confirmed && !pending ? "bg-danger" : "bg-danger/40"
        }`}
        disabled={!confirmed || pending}
        onPress={deleteAccount}
        testID={id("delete-confirm")}
      >
        <Text className="text-base font-semibold text-surface">
          {pending ? "Deleting…" : "Delete account"}
        </Text>
      </Pressable>
      <Pressable
        className="items-center py-2"
        disabled={pending}
        onPress={() => {
          setTyped("");
          setArmed(false);
        }}
        testID={id("delete-cancel")}
      >
        <Text className="text-base text-muted">Cancel</Text>
      </Pressable>
      {error === null ? null : (
        <Text className="text-sm text-danger" testID={id("delete-error")}>
          {error}
        </Text>
      )}
    </View>
  );
}
