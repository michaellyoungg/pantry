import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default — the pure domain layer must not need a DOM to run. The
    // hook tests opt into jsdom per file with a `@vitest-environment` docblock.
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
