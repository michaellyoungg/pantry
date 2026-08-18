import { defineConfig } from "vitest/config";

// Integration suite: Convex actions call a REAL recipe-service (no fetch mock).
// Opt-in — run with `pnpm --filter @pantry/convex test:integration` or the
// top-level `pnpm test:integration`. Kept separate from the default unit run
// (vitest.config.ts) so `pnpm test` stays hermetic and fast.
//
// The service is started/stopped by test/integration-setup.ts. The URL/secret
// below are injected into the test workers (so the actions' process.env reads
// resolve) and MUST mirror the defaults that setup file uses.

const port = process.env.RECIPE_SERVICE_TEST_PORT ?? "8099";
const secret = process.env.RECIPE_SERVICE_SECRET ?? "integration-test-secret";

export default defineConfig({
  test: {
    // convex-test runs Convex functions against an in-memory backend under an
    // edge-like runtime; convex-test must be inlined for its import.meta.glob
    // module discovery to work under Vite. (Same as vitest.config.ts.)
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.integration.test.ts"],
    globalSetup: ["./test/integration-setup.ts"],
    // Actions read these via process.env; test.env injects them into workers.
    env: {
      RECIPE_SERVICE_URL: `http://127.0.0.1:${port}`,
      RECIPE_SERVICE_SECRET: secret,
    },
    // The service starts once and is shared; run files serially so parallel
    // suites don't race on the same store.
    fileParallelism: false,
  },
});
