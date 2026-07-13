import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (BL-0014). These drive a real browser against a full
// compose-up stack (Postgres + recipe-service + self-hosted Convex) and the
// Vite dev server — they are deliberately NOT part of `pnpm test` (unit/fast).
// Bring the stack up and run them with `pnpm test:e2e` (see scripts/e2e.sh).
const PORT = 5173;
const HOST = "localhost";
// SITE_URL on the Convex deployment must match this origin or Convex Auth's JWT
// validation fails, so the dev server is pinned to localhost:5173.
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The full loop mutates shared per-deployment state, so keep it serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
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
