import {
  createSecureTokenStorage,
  SECURE_STORE_VALUE_LIMIT_BYTES,
  type SecureStoreBackend,
  splitIntoChunks,
  utf8ByteLength,
} from "./secureTokenStorage";

function fakeBackend() {
  const values = new Map<string, string>();
  const backend: SecureStoreBackend = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
  return { backend, values };
}

/** A JWT-shaped value of a given byte length. */
const token = (bytes: number) => "e".repeat(bytes);

const KEY = "__convexAuthJWT_http12700013210";

describe("utf8ByteLength", () => {
  it.each([
    ["ascii", "abc", 3],
    ["two-byte", "é", 2],
    ["three-byte", "€", 3],
    ["astral", "🥫", 4],
  ])("measures %s", (_label, value, expected) => {
    expect(utf8ByteLength(value)).toBe(expected);
  });
});

describe("splitIntoChunks", () => {
  it("keeps every chunk within the byte limit", () => {
    for (const chunk of splitIntoChunks(token(5000), 2048)) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
  });

  it("never splits a multi-byte character across chunks", () => {
    const chunks = splitIntoChunks("🥫".repeat(10), 8);

    expect(chunks.join("")).toBe("🥫".repeat(10));
    for (const chunk of chunks) {
      // Spreading iterates code points, so a *lone* surrogate — the signature of
      // a split character — shows up as a single unit in the surrogate range.
      // oxlint-disable-next-line typescript/no-misused-spread -- that split is what this test detects
      const hasLoneSurrogate = [...chunk].some((unit) => {
        const codePoint = unit.codePointAt(0) ?? 0;
        return codePoint >= 0xd800 && codePoint <= 0xdfff;
      });
      expect(hasLoneSurrogate).toBe(false);
    }
  });
});

describe("createSecureTokenStorage", () => {
  it("stores a normal-sized token as a single value", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    const jwt = token(900);

    await storage.setItem(KEY, jwt);

    expect(values.get(KEY)).toBe(jwt);
    expect([...values.keys()]).toEqual([KEY]);
    expect(await storage.getItem(KEY)).toBe(jwt);
  });

  it("round-trips a token over the iOS 2048-byte limit", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    const jwt = token(SECURE_STORE_VALUE_LIMIT_BYTES * 2 + 17);

    await storage.setItem(KEY, jwt);

    expect(await storage.getItem(KEY)).toBe(jwt);
    for (const [key, value] of values) {
      if (key === KEY) continue;
      expect(utf8ByteLength(value)).toBeLessThanOrEqual(SECURE_STORE_VALUE_LIMIT_BYTES);
    }
  });

  it("returns null when a chunk is missing rather than half a token", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    await storage.setItem(KEY, token(5000));

    values.delete(`${KEY}.1`);

    // Half a JWT would be sent, rejected, and look like a server problem.
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("cleans up chunks when a large value is replaced by a small one", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    await storage.setItem(KEY, token(6000));

    await storage.setItem(KEY, token(100));

    expect([...values.keys()]).toEqual([KEY]);
    expect(await storage.getItem(KEY)).toBe(token(100));
  });

  it("drops chunks that a shorter large value no longer needs", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    await storage.setItem(KEY, token(SECURE_STORE_VALUE_LIMIT_BYTES * 4));

    await storage.setItem(KEY, token(SECURE_STORE_VALUE_LIMIT_BYTES * 2));

    expect(values.has(`${KEY}.2`)).toBe(false);
    expect(await storage.getItem(KEY)).toBe(token(SECURE_STORE_VALUE_LIMIT_BYTES * 2));
  });

  it("removes every chunk on sign-out", async () => {
    const { backend, values } = fakeBackend();
    const storage = createSecureTokenStorage(backend);
    await storage.setItem(KEY, token(6000));

    await storage.removeItem(KEY);

    expect(values.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("reads absent keys as null", async () => {
    const { backend } = fakeBackend();
    expect(await createSecureTokenStorage(backend).getItem(KEY)).toBeNull();
  });
});
