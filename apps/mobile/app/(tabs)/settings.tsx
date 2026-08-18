import { useAuthActions } from "@convex-dev/auth/react";
import { Pressable, Text } from "react-native";
import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { DeleteAccount } from "../../src/settings/DeleteAccount";
import { surfaceTestIDs } from "../../src/testing/testIDs";

const id = surfaceTestIDs("settings");

export default function SettingsScreen() {
  const { signOut } = useAuthActions();

  return (
    <PlaceholderScreen surface="settings" title="Settings" portedBy="BL-0066">
      {/*
        Sign-out lives here ahead of the rest of Settings because without it
        there is no way to leave a session on a device — the simulator's only
        alternative is deleting the app.
      */}
      <Pressable
        className="mt-4 rounded-lg border border-border px-4 py-3"
        onPress={() => signOut()}
        testID={id("sign-out")}
      >
        <Text className="text-base text-danger">Sign out</Text>
      </Pressable>

      {/*
        And deletion, for a harder reason than convenience: App Store guideline
        5.1.1(v) requires in-app account deletion from any build that offers
        account creation, so this ships before the screen it belongs to (BL-0068).
      */}
      <DeleteAccount />
    </PlaceholderScreen>
  );
}
