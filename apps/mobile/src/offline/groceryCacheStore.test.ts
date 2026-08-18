import { GROCERY_CACHE_KEY, groceryCacheStore, type KeyValueBackend } from "./groceryCacheStore";

function fakeBackend(overrides: Partial<KeyValueBackend> = {}): KeyValueBackend {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    ...overrides,
  };
}

describe("groceryCacheStore", () => {
  it("round-trips under one namespaced key", async () => {
    const backend = fakeBackend();
    const store = groceryCacheStore(backend);

    await store.write('{"version":1}');

    expect(backend.setItem).toHaveBeenCalledWith(GROCERY_CACHE_KEY, '{"version":1}');
    expect(await store.read()).toBe('{"version":1}');
  });

  it("reads nothing before anything has been written", async () => {
    expect(await groceryCacheStore(fakeBackend()).read()).toBeNull();
  });

  it("clears the key", async () => {
    const backend = fakeBackend();
    const store = groceryCacheStore(backend);
    await store.write("{}");

    await store.clear();

    expect(backend.removeItem).toHaveBeenCalledWith(GROCERY_CACHE_KEY);
    expect(await store.read()).toBeNull();
  });

  it("reads as a fresh install when storage is unreadable", async () => {
    // Storage failing is a reason to shop without a cache, never a reason to
    // throw out of a render and take the list down mid-shop.
    const store = groceryCacheStore(
      fakeBackend({
        getItem: jest.fn(async () => {
          throw new Error("SQLite: disk I/O error");
        }),
      }),
    );

    await expect(store.read()).resolves.toBeNull();
  });

  it("swallows a failed write", async () => {
    const store = groceryCacheStore(
      fakeBackend({
        setItem: jest.fn(async () => {
          throw new Error("database or disk is full");
        }),
      }),
    );

    await expect(store.write("{}")).resolves.toBeUndefined();
  });

  it("swallows a failed clear", async () => {
    const store = groceryCacheStore(
      fakeBackend({
        removeItem: jest.fn(async () => {
          throw new Error("database or disk is full");
        }),
      }),
    );

    await expect(store.clear()).resolves.toBeUndefined();
  });
});
