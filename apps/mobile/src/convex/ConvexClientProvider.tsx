/**
 * Wires the Convex client and Convex Auth into the app tree.
 *
 * `storage` is not optional here: `ConvexAuthProvider` falls back to
 * `localStorage`, which React Native does not have, so without it a session
 * lasts exactly as long as the process. See `secureTokenStorage.ts`.
 */
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { convexStorageNamespace, createConvexClient, resolveConvexUrl } from "./client";
import { createSecureTokenStorage } from "./secureTokenStorage";

/**
 * `AFTER_FIRST_UNLOCK` rather than the `WHEN_UNLOCKED` default: the token needs
 * to be readable when the app is woken in the background (a refresh, and later
 * a push handler), which `WHEN_UNLOCKED` would deny on a locked device.
 */
const tokenStorage = createSecureTokenStorage({
  getItemAsync: (key) =>
    SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    }),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
});

export function ConvexClientProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** Injectable so a test can mount the tree without a live deployment. */
  client?: ConvexReactClient;
}) {
  const convexUrl = resolveConvexUrl();
  const convex = useMemo(() => client ?? createConvexClient(convexUrl), [client, convexUrl]);

  return (
    <ConvexAuthProvider
      client={convex}
      storage={tokenStorage}
      storageNamespace={convexStorageNamespace(convexUrl)}
    >
      {children}
    </ConvexAuthProvider>
  );
}
