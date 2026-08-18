import { defineConfig } from "vitest/config";

// This package has no runtime of its own; the suite exists to test the codegen
// that produces most of it (see src/contractCodegen.test.ts).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
