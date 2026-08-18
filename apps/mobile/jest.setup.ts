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

// The offline grocery cache's backing store (BL-0058). The package ships its
// own in-memory Jest double, so this is the upstream implementation rather than
// a hand-rolled Map that could drift from it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
