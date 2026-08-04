import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "rec-user";
const identity = { subject: `${USER_ID}|session` };

const DAY = 86_400_000;

/**
 * Unit-level contract check for what the action PUTS ON THE WIRE. The
 * integration suite proves Go agrees; this proves the payload is assembled at
 * all, and it runs with no backend.
 */
function stubService(): { url: string; body: Record<string, unknown> }[] {
  vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
  vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

async function seedPantry(
  t: ReturnType<typeof convexTest>,
  row: { canonicalItem: string; useBy?: number },
) {
  await t.run(async (ctx) =>
    ctx.db.insert("pantryItems", {
      userId: USER_ID,
      canonicalItem: row.canonicalItem,
      display: row.canonicalItem,
      aisle: "produce",
      state: "have" as const,
      source: "auto" as const,
      updatedAt: 0,
      useBy: row.useBy,
    }),
  );
}

describe("recommendations.pantry request payload (BL-0050)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("forwards each row's shelf-life date so expiry can be scored", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    const useBy = Date.now() + 2 * DAY;
    await seedPantry(t, { canonicalItem: "spinach", useBy });

    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://recipe-service/recommendations/pantry");
    expect(calls[0].body.pantry).toEqual([
      { canonicalItem: "spinach", state: "have", useItUp: false, useBy },
    ]);
  });

  // Absence must survive the trip: a row the shelf-life table doesn't know has
  // no date, which is not the same as a far-off one.
  it("sends no date for a row that has none", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });

    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    const pantry = calls[0].body.pantry as { useBy?: number }[];
    expect(pantry[0].useBy).toBeUndefined();
  });

  // The ranker scores expiry against the CALLER's clock so it stays a pure
  // function of its request; without this the feature reports unavailable.
  it("sends the clock", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });

    const before = Date.now();
    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    const now = calls[0].body.now as number;
    expect(typeof now).toBe("number");
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    stubService();
    await expect(t.action(api.recommendations.pantry, {})).rejects.toThrow(/Not authenticated/);
  });
});

// The discovery facets are stored on the recipe and the tastes are stored here,
// but they only ever meet inside the ranker. A preference that never leaves
// Convex is a setting the user can change with no observable effect (BL-0030).
describe("recommendations request carries stated tastes (BL-0030)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  async function seedTastes(
    t: ReturnType<typeof convexTest>,
    tastes: { cuisines?: string[]; maxMinutes?: number },
  ) {
    await t.withIdentity(identity).mutation(api.preferences.set, tastes);
  }

  it("forwards the cuisines and cook-time limit on the pantry surface", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });
    await seedTastes(t, { cuisines: ["thai", "italian"], maxMinutes: 30 });

    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    const prefs = calls[0].body.preferences as { cuisines?: string[]; maxMinutes?: number };
    expect(prefs.cuisines).toEqual(["thai", "italian"]);
    expect(prefs.maxMinutes).toBe(30);
  });

  // Week selection ranks through the same endpoint, so a taste that only
  // reached one of the two surfaces would silently be half-applied.
  it("forwards them on the week-candidates surface too", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });
    await seedTastes(t, { cuisines: ["thai"], maxMinutes: 45 });

    await t.withIdentity(identity).action(api.recommendations.weekCandidates, {});

    const prefs = calls[0].body.preferences as { cuisines?: string[]; maxMinutes?: number };
    expect(prefs.cuisines).toEqual(["thai"]);
    expect(prefs.maxMinutes).toBe(45);
  });

  // An unset limit must arrive as absent, not as 0. Zero is a limit nothing
  // satisfies; absent is the "no opinion" the ranker degrades to.
  it("sends no cook-time limit when the user has not set one", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });

    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    const prefs = calls[0].body.preferences as { cuisines?: string[]; maxMinutes?: number };
    expect(prefs.maxMinutes).toBeUndefined();
    expect(prefs.cuisines).toEqual([]);
  });
});
