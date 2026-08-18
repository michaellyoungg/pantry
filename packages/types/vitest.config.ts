import { defineConfig } from "vitest/config";

// This package has no runtime of its own; the suite tests the codegen that
// produces most of it.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
