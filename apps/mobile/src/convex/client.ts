/**
 * The Convex connection for the native client.
 *
 * Convex is the only backend entry point (parity plan rule 2), so this is the
 * single place a URL is read. The resolution order is separated from the client
 * construction so it can be tested without opening a websocket.
 */

import { ConvexReactClient } from "convex/react";
import Constants from "expo-constants";

/** Fallback for a simulator talking to the local self-hosted stack. */
export const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";

/**
 * Resolves the deployment URL.
 *
 * `EXPO_PUBLIC_CONVEX_URL` wins so a build can be pointed at a deployment
 * without editing `app.json`; `extra.convexUrl` is the checked-in default.
 *
 * A physical device cannot reach `127.0.0.1` — that is the simulator's own
 * loopback. Until BL-0006 puts the backend on a public host, run
 * `pnpm --filter @pantry/mobile start:tunnel` and set `EXPO_PUBLIC_CONVEX_URL`
 * to the tunnelled address. See `apps/mobile/README.md`.
 */
export function resolveConvexUrl(
  env: Record<string, string | undefined> = process.env,
  extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra,
): string {
  const fromEnv = env.EXPO_PUBLIC_CONVEX_URL;
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;

  const fromConfig = extra?.convexUrl;
  if (typeof fromConfig === "string" && fromConfig !== "") return fromConfig;

  return DEFAULT_CONVEX_URL;
}

/**
 * The namespace Convex Auth qualifies its storage keys with.
 *
 * `ConvexAuthProvider` strips every non-alphanumeric character from whatever it
 * is given (for React Native key compatibility), so two deployments that differ
 * only in punctuation would share a namespace — and therefore share tokens.
 * Deriving it here, and asserting on it in a test, keeps that surprise visible.
 */
export function convexStorageNamespace(convexUrl: string): string {
  return convexUrl.replace(/[^a-zA-Z0-9]/g, "");
}

export function createConvexClient(convexUrl: string = resolveConvexUrl()): ConvexReactClient {
  return new ConvexReactClient(convexUrl, {
    // A browser-only affordance built on `window.onbeforeunload`.
    unsavedChangesWarning: false,
  });
}
