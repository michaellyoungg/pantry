import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (BL-0014). These drive a real browser against a full
// compose-up stack (Postgres + recipe-service + self-hosted Convex) and the
// Vite dev server — they are deliberately NOT part of `pnpm test` (unit/fast).
// Bring the stack up and run them with `pnpm test:e2e` (see scripts/e2e.sh).
// Default 5173, overridable via E2E_PORT. The override exists because
// `reuseExistingServer` (below) means a stale dev server squatting the default
// port is silently adopted, and the suite then reports on whatever *that*
// server is serving. scripts/e2e.sh reads the same variable and points the
// deployment's SITE_URL at it.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const HOST = "localhost";
// SITE_URL on the Convex deployment must match this origin exactly or Convex
// Auth's JWT validation fails, which is why the port is a single constant
// shared with scripts/e2e.sh rather than set independently in two places.
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The full loop mutates shared per-deployment state, so keep it serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI also emit an HTML report (uploaded as an artifact) for debugging.
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  // Convex round-trips (auth, recipe-service aggregation) are slower than a
  // pure client render, so give assertions and each test more headroom.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Playwright starts the Vite dev server. The app defaults to the local
  // Convex backend (VITE_CONVEX_URL falls back to http://127.0.0.1:3210), so no
  // extra env is required beyond a running stack.
  webServer: {
    command: `pnpm exec vite --host ${HOST} --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
