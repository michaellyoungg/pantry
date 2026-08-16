/**
 * Splits the tree on authentication state.
 *
 * `AuthLoading` is not cosmetic here: on a cold start the session is read from
 * SecureStore, which is asynchronous, so without this branch a signed-in user
 * sees the sign-in form flash before their own data arrives.
 */

import { colorTokens } from "@pantry/design-tokens";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { testID } from "../testing/testIDs";
import { AuthForm } from "./AuthForm";

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <View
          className="flex-1 items-center justify-center bg-bg"
          testID={testID("app", "loading")}
        >
          <ActivityIndicator color={colorTokens.primary} />
        </View>
      </AuthLoading>
      <Unauthenticated>
        <AuthForm />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
