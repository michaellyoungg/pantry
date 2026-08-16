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
module.exports = {
  preset: "jest-expo",
  resolver: "<rootDir>/jest.resolver.js",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  collectCoverageFrom: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "metro.workspace-source.js"],
};
