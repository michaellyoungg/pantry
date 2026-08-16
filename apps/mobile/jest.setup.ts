/**
 * Native modules that have no JS implementation in a Node test process.
 *
 * Kept to the minimum: anything mocked here is behaviour no unit test can
 * observe, so a long list is a signal that logic has drifted into the app and
 * belongs in `@pantry/core` instead.
 */
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});
