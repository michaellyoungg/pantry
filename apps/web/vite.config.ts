/// <reference types="vitest/config" />

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts", "src/main.tsx"],
      // Ratchet floor set just below current coverage so CI catches
      // regressions. Raise these as tests are added (the lib layer already
      // sits near 100%; the feature components are the gap to close).
      thresholds: {
        lines: 50,
        functions: 40,
        branches: 50,
        statements: 48,
      },
    },
  },
});
