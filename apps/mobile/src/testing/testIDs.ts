/**
 * The selector contract, re-exported for this app's screens.
 *
 * BL-0056 established the scheme here, before the first screen existed. BL-0071
 * moved the implementation to `@pantry/core/testing` so the web client emits
 * the same strings as `data-testid` — there is one builder, not one per client.
 * Screens keep importing it from this path; nothing about their usage changed.
 *
 * See `docs/mobile-testid-conventions.md`.
 */
export {
  surfaceTestIDs,
  TEST_ID_PATTERN,
  type TestIDSurface,
  testID,
  testIDKey,
} from "@pantry/core/testing";
