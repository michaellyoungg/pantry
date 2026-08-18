// @pantry/core/testing — the selector contract both clients emit.
//
// `data-testid` on web, `testID` on native, built from one place so a journey
// named on one client is findable on the other. See
// `docs/mobile-testid-conventions.md`.

export { TEST_IDS } from "./sharedTestIDs";
export {
  surfaceTestIDs,
  TEST_ID_PATTERN,
  type TestID,
  type TestIDSurface,
  testID,
  testIDKey,
  testIDPrefix,
} from "./testIDs";
