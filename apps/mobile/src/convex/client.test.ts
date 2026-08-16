import { convexStorageNamespace, DEFAULT_CONVEX_URL, resolveConvexUrl } from "./client";

describe("resolveConvexUrl", () => {
  it("prefers EXPO_PUBLIC_CONVEX_URL so a build can be retargeted without editing app.json", () => {
    expect(
      resolveConvexUrl(
        { EXPO_PUBLIC_CONVEX_URL: "https://pantry.convex.cloud" },
        {
          convexUrl: "http://127.0.0.1:3210",
        },
      ),
    ).toBe("https://pantry.convex.cloud");
  });

  it("falls back to the checked-in app config", () => {
    expect(resolveConvexUrl({}, { convexUrl: "http://10.0.2.2:3210" })).toBe(
      "http://10.0.2.2:3210",
    );
  });

  it("ignores an empty override rather than connecting to nothing", () => {
    expect(resolveConvexUrl({ EXPO_PUBLIC_CONVEX_URL: "" }, { convexUrl: "http://x:3210" })).toBe(
      "http://x:3210",
    );
  });

  it("falls back to simulator loopback with no configuration at all", () => {
    expect(resolveConvexUrl({}, undefined)).toBe(DEFAULT_CONVEX_URL);
  });
});

describe("convexStorageNamespace", () => {
  it("matches the stripping ConvexAuthProvider applies for React Native", () => {
    expect(convexStorageNamespace("http://127.0.0.1:3210")).toBe("http1270013210");
  });

  it("collapses deployments that differ only in punctuation — they share tokens", () => {
    // Not a bug to fix here, a hazard to know about: two such deployments would
    // read each other's session out of SecureStore.
    expect(convexStorageNamespace("https://a-b.convex.cloud")).toBe(
      convexStorageNamespace("https://ab.convex.cloud"),
    );
  });
});
