/**
 * `TokenStorage` for `ConvexAuthProvider`, backed by `expo-secure-store`.
 *
 * `ConvexAuthProvider` defaults to `localStorage`, which does not exist in React
 * Native, so the `storage` prop is required here. Convex Auth writes two values
 * under the namespaced keys `__convexAuthJWT_<ns>` and
 * `__convexAuthRefreshToken_<ns>`.
 *
 * Why this is not a four-line wrapper
 * -----------------------------------
 * iOS SecureStore warns above **2048 bytes per value** and may refuse to store
 * larger ones. A Convex access token is a JWT whose size grows with its claims,
 * so it sits close enough to that ceiling to be a real risk rather than a
 * theoretical one — and it would fail in production, on the accounts with the
 * most data, long after this code was written.
 *
 * So the ceiling is handled here rather than discovered later: a value that
 * exceeds the limit is split across `<key>.0`, `<key>.1`, … with a sentinel
 * under `<key>` recording the count. Values under the limit are stored as-is,
 * so the common case is one read and one write, and nothing needs migrating.
 *
 * The backend is injected so the chunking is unit-testable without a native
 * module. `expoSecureTokenStorage()` binds it to the real one.
 */

/**
 * iOS's documented per-value warning threshold. Android's Keystore-backed
 * `SharedPreferences` has no comparable limit, so this is applied on both
 * platforms for a single behaviour rather than a per-platform one.
 */
export const SECURE_STORE_VALUE_LIMIT_BYTES = 2048;

/**
 * Marks a chunked value. `:` is outside the base64url alphabet a JWT is built
 * from, so this cannot collide with a token stored whole.
 */
const CHUNK_SENTINEL = "__pantry_chunked__:";

/** The subset of `expo-secure-store` this needs. */
export interface SecureStoreBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface TokenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** UTF-8 byte length, without assuming a `TextEncoder`/`Buffer` global exists. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Splits on code-point boundaries so a chunk is never a truncated character,
 * and measures in bytes so a multi-byte value still respects the limit.
 */
export function splitIntoChunks(value: string, limitBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (currentBytes + characterBytes > limitBytes && current !== "") {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current !== "") chunks.push(current);
  return chunks;
}

const chunkKey = (key: string, index: number) => `${key}.${index}`;

/**
 * How many chunks the value at `key` was previously split into, or `null` if it
 * was stored whole (or is absent).
 */
function readChunkCount(stored: string | null): number | null {
  if (stored === null || !stored.startsWith(CHUNK_SENTINEL)) return null;
  const count = Number.parseInt(stored.slice(CHUNK_SENTINEL.length), 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function createSecureTokenStorage(
  backend: SecureStoreBackend,
  limitBytes: number = SECURE_STORE_VALUE_LIMIT_BYTES,
): TokenStorage {
  /** Clears any chunks left by a previous, larger value at this key. */
  async function clearChunks(key: string, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await backend.deleteItemAsync(chunkKey(key, index));
    }
  }

  return {
    async getItem(key) {
      const stored = await backend.getItemAsync(key);
      const chunkCount = readChunkCount(stored);
      if (chunkCount === null) return stored;

      const parts: string[] = [];
      for (let index = 0; index < chunkCount; index += 1) {
        const part = await backend.getItemAsync(chunkKey(key, index));
        // A missing chunk means a partial write or a partial wipe. Half a token
        // is worse than no token: report absence so the client re-authenticates
        // rather than sending something that will fail to verify.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },

    async setItem(key, value) {
      const previousChunks = readChunkCount(await backend.getItemAsync(key)) ?? 0;

      if (utf8ByteLength(value) <= limitBytes) {
        await backend.setItemAsync(key, value);
        await clearChunks(key, previousChunks);
        return;
      }

      const chunks = splitIntoChunks(value, limitBytes);
      for (const [index, chunk] of chunks.entries()) {
        await backend.setItemAsync(chunkKey(key, index), chunk);
      }
      // The sentinel is written last, so an interrupted write leaves the old
      // value readable rather than a half-written new one.
      await backend.setItemAsync(key, `${CHUNK_SENTINEL}${chunks.length}`);
      if (previousChunks > chunks.length) {
        for (let index = chunks.length; index < previousChunks; index += 1) {
          await backend.deleteItemAsync(chunkKey(key, index));
        }
      }
    },

    async removeItem(key) {
      const chunkCount = readChunkCount(await backend.getItemAsync(key)) ?? 0;
      await backend.deleteItemAsync(key);
      await clearChunks(key, chunkCount);
    },
  };
}
