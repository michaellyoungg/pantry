/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// convex-test runs Convex functions against an in-memory backend. It needs the
// edge-runtime environment (the Convex runtime is edge-like, not Node) and
// convex-test inlined so its import.meta.glob module discovery works under Vite.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    // Integration tests hit a real recipe-service and run under a separate
    // config (vitest.integration.config.ts); keep the default unit run hermetic.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
