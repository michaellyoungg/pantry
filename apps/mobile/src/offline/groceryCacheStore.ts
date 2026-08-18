/**
 * The device half of the offline grocery cache (BL-0058).
 *
 * `@pantry/core` owns what the cache *is* — the shape, the versioning, the
 * collapse and the replay — and takes an `OfflineStore` for where it goes. This
 * is that store, and it is deliberately the only file in this feature that
 * knows a native module exists.
 *
 * **`AsyncStorage`, not `expo-secure-store`.** The app already has SecureStore
 * for the auth tokens, so reaching for it again is the obvious move and the
 * wrong one: it is keychain/Keystore-backed, warns above 2048 bytes per value
 * (see `secureTokenStorage.ts`, which exists to work around exactly that), and
 * a week's grocery list with its provenance is comfortably larger. A shopping
 * list is also not a secret — it is user data with a durability requirement,
 * which is what `AsyncStorage` is for.
 *
 * The backend is injected so the key scheme and the error handling are
 * testable without a native module, matching `secureTokenStorage.ts`.
 */

import type { OfflineStore } from "@pantry/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Namespaced, so a future second cached surface does not have to guess whether
 * this key is taken. Not namespaced by *user*: the auth token and this cache
 * are cleared together on sign-out, and a per-user key would instead leave one
 * shopper's list on the device under a key nobody ever reads again.
 */
export const GROCERY_CACHE_KEY = "pantry.grocery.cache.v1";

/** The subset of `AsyncStorage` this needs. */
export type KeyValueBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Every failure is swallowed, and that is the whole point.
 *
 * The cache is an optimisation over a list the server still has. Storage being
 * full, or unavailable, or corrupt is a reason to shop without the cache — it
 * is never a reason to throw out of a render and take the grocery screen down
 * in the middle of a shop, which is the one place the app has to keep working.
 * A read that fails reads as "no cache", which the core layer already handles
 * as a fresh install.
 */
export function groceryCacheStore(backend: KeyValueBackend = AsyncStorage): OfflineStore {
  return {
    async read() {
      try {
        return await backend.getItem(GROCERY_CACHE_KEY);
      } catch {
        return null;
      }
    },
    async write(value) {
      try {
        await backend.setItem(GROCERY_CACHE_KEY, value);
      } catch {
        // Nothing to do and nobody to tell: the list on screen is unaffected.
      }
    },
    async clear() {
      try {
        await backend.removeItem(GROCERY_CACHE_KEY);
      } catch {
        // As above.
      }
    },
  };
}
