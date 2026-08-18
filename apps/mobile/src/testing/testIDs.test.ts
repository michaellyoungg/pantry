import { surfaceTestIDs, testID, testIDKey } from "./testIDs";

// The scheme itself is tested in `packages/core/src/testing/testIDs.test.ts`,
// under vitest. What is worth asserting *here* is that it survives the trip
// into this app: Metro resolves `@pantry/core/testing` to the package's source
// (see metro.workspace-source.js), and a subpath that resolved to a stale
// `dist/` — or not at all — would break every screen's testIDs at once.
describe("testIDs", () => {
  it("re-exports the shared scheme", () => {
    expect(testID("list", "item", testIDKey("Whole Milk"))).toBe("list.item.whole-milk");
    expect(surfaceTestIDs("auth")("form")).toBe("auth.form");
  });

  it("still rejects a malformed segment", () => {
    expect(() => testID("list", "Generate Button")).toThrow(/lowercase alphanumeric/);
  });
});
