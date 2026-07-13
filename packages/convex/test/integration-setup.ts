import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

// Vitest globalSetup for the Convex <-> recipe-service integration suite.
//
// It boots a REAL recipe-service and leaves it running for the duration of the
// suite. The Convex actions under test (packages/convex/convex/recipes.ts) then
// make genuine HTTP calls to it — no fetch mock — so the test exercises the
// actual service-to-service contract (paths, headers, JSON shapes, auth).
//
// Data store:
//   - If PANTRY_TEST_DATABASE_URL is set, the service runs against real
//     Postgres (full integration — this is what CI does).
//   - Otherwise it falls back to the in-memory store, so the contract can be
//     verified locally with zero infrastructure.
//
// The URL/secret the actions read (RECIPE_SERVICE_URL / RECIPE_SERVICE_SECRET)
// are injected into the test workers via `test.env` in vitest.integration.config.ts;
// this file must derive them from the same env with the same defaults.

const PORT = process.env.RECIPE_SERVICE_TEST_PORT ?? "8099";
const SECRET = process.env.RECIPE_SERVICE_SECRET ?? "integration-test-secret";
const HEALTH_URL = `http://127.0.0.1:${PORT}/healthz`;

// Where to find the service. In CI we prebuild a binary and point at it via
// RECIPE_SERVICE_BIN (fast). Locally we fall back to `go run`, which compiles
// on the fly (slower first start, but no build step to remember).
const SERVICE_DIR = new URL("../../../apps/recipe-service", import.meta.url).pathname;

function startService(): ChildProcess {
  const env = {
    ...process.env,
    PORT,
    RECIPE_SERVICE_SECRET: SECRET,
    // Present => Postgres store; absent => in-memory store.
    ...(process.env.PANTRY_TEST_DATABASE_URL
      ? { DATABASE_URL: process.env.PANTRY_TEST_DATABASE_URL }
      : {}),
  };

  const bin = process.env.RECIPE_SERVICE_BIN;
  const child = bin
    ? spawn(bin, { cwd: SERVICE_DIR, env, stdio: "inherit" })
    : spawn("go", ["run", "./cmd/server"], { cwd: SERVICE_DIR, env, stdio: "inherit" });

  child.on("error", (err) => {
    throw new Error(`failed to start recipe-service: ${err.message}`);
  });
  return child;
}

async function waitForHealthy(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`recipe-service exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`recipe-service did not become healthy at ${HEALTH_URL} within 30s`);
}

export default async function setup() {
  const child = startService();
  await waitForHealthy(child);

  // Teardown: stop the service after the suite completes.
  return async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), sleep(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
}
