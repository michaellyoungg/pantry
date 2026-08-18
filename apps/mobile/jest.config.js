/**
 * `jest-expo` + React Native Testing Library.
 *
 * A deliberate divergence from the repo's Vitest standard, scoped to this app:
 * Vitest cannot drive React Native (the Flow/Metro transform pipeline is
 * Babel/Jest shaped). Shared logic stays on Vitest in `packages/core`, which is
 * where the behavioural weight belongs anyway — see
 * `docs/mobile-testing-strategy.md`.
 *
 * @type {import('jest').Config}
 */
/**
 * `lucide-react-native` (BL-0054) publishes ESM only, so Jest has to transform
 * it rather than ignore it. `jest-expo`'s pattern allows `.pnpm`, but pnpm
 * nests the real package as
 * `node_modules/.pnpm/<pkg>@<version>/node_modules/lucide-react-native/…` — and
 * the pattern matches that *inner* `/node_modules/` too, where `.pnpm` no
 * longer appears. The package therefore has to be named in the allow-list
 * itself. Derived from the preset rather than restated so it tracks upstream.
 */
const expoPreset = require("jest-expo/jest-preset");
const presetIgnorePatterns = expoPreset.transformIgnorePatterns;
const ALLOW = "(?!(.pnpm|";
const transformIgnorePatterns = presetIgnorePatterns.map((pattern) =>
  pattern.includes(ALLOW) ? pattern.replace(ALLOW, `${ALLOW}lucide-react-native|`) : pattern,
);
if (transformIgnorePatterns.every((pattern, i) => pattern === presetIgnorePatterns[i])) {
  throw new Error(
    "jest-expo's transformIgnorePatterns no longer match the expected shape; " +
      "re-check how ESM-only packages are allowed through.",
  );
}

// The preset's JS transform key is `\.[jt]sx?$`, which does not match `.mjs` —
// so lucide's ESM entrypoint would be left untransformed even once it is
// allowed through above. Reuse the preset's own babel-jest configuration for
// `.mjs` rather than declaring a second, drifting one.
const JS_TRANSFORM_KEY = "\\.[jt]sx?$";
const jsTransform = expoPreset.transform?.[JS_TRANSFORM_KEY];
if (!jsTransform) {
  throw new Error(`jest-expo no longer exposes a transform for ${JS_TRANSFORM_KEY}.`);
}

module.exports = {
  preset: "jest-expo",
  // Jest's 5s default is too tight for this runner. The FIRST `render` in a
  // worker pays React Native's one-time initialisation on top of the component
  // itself — locally that is ~2s, and CI's runners are roughly 2.5x slower, so
  // the first test of a screen suite lands right on the limit and fails as a
  // timeout that looks nothing like its cause. Every subsequent test in the
  // same file runs in milliseconds.
  testTimeout: 20_000,
  transformIgnorePatterns,
  transform: { ...expoPreset.transform, "\\.mjs$": jsTransform },
  resolver: "<rootDir>/jest.resolver.js",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  collectCoverageFrom: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "metro.workspace-source.js"],
};
