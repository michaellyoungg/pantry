import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Playwright specs live in e2e/ and share the `.spec.ts` suffix; keep the
    // vitest (unit) runner from picking them up — they run via `pnpm test:e2e`.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/routes/**",
        "src/routeTree.gen.ts",
      ],
      // Ratchet floor set just below current coverage so CI catches
      // regressions. Raise these as tests are added (the lib layer already
      // sits near 100%; the feature components are the gap to close).
      thresholds: {
        lines: 50,
        functions: 40,
        branches: 45,
        statements: 48,
      },
    },
  },
});
