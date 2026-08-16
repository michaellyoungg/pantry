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
  // Kept false: specs parallelise against each other at file granularity, which
  // is the level the isolation actually holds at (one spec = one fresh account).
  fullyParallel: false,
  // Two, on evidence — see docs/e2e-parallelism.md for the full experiment.
  //
  // The previous value was 1, with the comment "the full loop mutates shared
  // per-deployment state, so keep it serial". That was wrong about the cause.
  // Specs already isolate themselves: `signUp()` mints a fresh account per spec
  // and `uniqueSuffix()` namespaces titles, so nothing user-scoped is shared. In
  // 45 CI runs across worker counts we never saw one spec observe another's
  // data, and the residual flakiness is *identical at 1 worker and at 4* — the
  // same three failures show up in both arms, so serialising bought no
  // stability at all. What the pin actually did was mask latent races in the
  // specs themselves, which are fixed in this change.
  //
  // Two rather than four because the benefit saturates there. Playwright's own
  // reported duration on a 4-vCPU CI runner: ~37s at 1 worker, ~29s at 2, ~29s
  // at 4. Past two the critical path is the longest single spec file, so more
  // workers only add contention — and the contention is real: the browsers, the
  // Vite server and the whole compose stack (Postgres + recipe-service +
  // self-hosted Convex) share those four cores, and oversubscribing them
  // surfaces as `Function execution timed out (maximum duration: 1s)`.
  //
  // Worth knowing before optimising further: this is ~29s of a ~140s job. The
  // rest is stack setup, which is where the remaining wall clock lives.
  workers: 2,
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
