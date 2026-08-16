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
function stubService(payload: unknown = { results: [] }): {
  url: string;
  body: Record<string, unknown>;
}[] {
  vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
  vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(payload), {
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

describe("generated candidates (BL-0034)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  const draft = {
    recipeId: "gen-abc",
    title: "Garlic Fried Rice",
    servings: 2,
    ingredients: [{ quantity: 1, unit: "cup", item: "rice" }],
    steps: ["Cook the rice."],
  };

  it("passes generated drafts through alongside the ranked results", async () => {
    const t = convexTest(schema, modules);
    stubService({
      results: [{ recipeId: "gen-abc", title: "Garlic Fried Rice", source: "generated" }],
      generated: [draft],
    });
    await seedPantry(t, { canonicalItem: "rice" });

    const out = await t.withIdentity(identity).action(api.recommendations.pantry, {});

    expect(out.results[0].source).toBe("generated");
    expect(out.generated).toEqual([draft]);
  });

  // The path that actually runs today: no API key means recipe-service sends no
  // `generated` key at all, and the action must not turn that into undefined.
  it("degrades to an empty list when the service sends no generated field", async () => {
    const t = convexTest(schema, modules);
    stubService({ results: [] });
    await seedPantry(t, { canonicalItem: "rice" });

    const out = await t.withIdentity(identity).action(api.recommendations.pantry, {});

    expect(out.generated).toEqual([]);
  });

  it("persists an accepted draft as a real recipe tagged ai-generated", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService({ id: "r1", title: draft.title });

    await t.withIdentity(identity).action(api.recommendations.acceptGenerated, {
      title: draft.title,
      servings: draft.servings,
      ingredients: draft.ingredients,
      steps: draft.steps,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://recipe-service/recipes");
    expect(calls[0].body.title).toBe("Garlic Fried Rice");
    expect(calls[0].body.ingredients).toEqual(draft.ingredients);
    // The row says where it came from long after the card that labelled it is gone.
    expect(calls[0].body.tags).toEqual(["ai-generated"]);
  });

  it("refuses to persist a draft for an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    stubService();
    await expect(
      t.action(api.recommendations.acceptGenerated, {
        title: draft.title,
        ingredients: draft.ingredients,
        steps: draft.steps,
      }),
    ).rejects.toThrow(/Not authenticated/);
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

  // The pantry surface learns too — it just weights taste far below what is
  // about to spoil (see DefaultPantryWeights).
  it("sends affinities but not interactions on the pantry surface", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedPantry(t, { canonicalItem: "rice" });

    await t.withIdentity(identity).action(api.recommendations.pantry, {});

    expect(calls[0].body.affinities).toEqual({});
    // Novelty is a discovery concern: being told a recipe is new is not an
    // answer to "what can I make with this spinach".
    expect(calls[0].body.interactions).toBeUndefined();
  });
});

// --- The discovery surface (BL-0005 increment 2) -------------------------

describe("recommendations.discover request payload", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  async function seedEvent(
    t: ReturnType<typeof convexTest>,
    row: {
      recipeId: string;
      action: "shown" | "accepted" | "dismissed" | "cooked";
      canonicalItems?: string[];
    },
  ) {
    await t.run(async (ctx) =>
      ctx.db.insert("recommendationEvents", {
        userId: USER_ID,
        context: "discover" as const,
        createdAt: Date.now(),
        ...row,
      }),
    );
  }

  it("posts to the discover endpoint, not the pantry one", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    expect(calls[0].url).toBe("http://recipe-service/recommendations/discover");
  });

  it("requires an authenticated caller", async () => {
    const t = convexTest(schema, modules);
    stubService();
    await expect(t.action(api.recommendations.discover, {})).rejects.toThrow(/Not authenticated/);
  });

  // THE cold-start contract, stated on the wire. An empty object is what makes
  // the Go ranker report `affinity` unavailable; a map of zeroes would make it
  // available and quietly punish every new user on the surface that weights it
  // most heavily.
  it("sends an empty affinity map for a user with no history", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    expect(calls[0].body.affinities).toEqual({});
  });

  it("sends derived affinities once the user has interacted", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedEvent(t, { recipeId: "r1", action: "cooked", canonicalItems: ["garlic"] });

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    const affinities = calls[0].body.affinities as Record<string, number>;
    expect(affinities.garlic).toBeGreaterThan(0);
  });

  // Always sent, even when empty. Omitted means "no history was sent" and makes
  // novelty unavailable; empty means "this user has interacted with nothing",
  // which makes every candidate equally new — a real observation, not a gap.
  it("always sends the interactions map, empty included", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    expect(calls[0].body.interactions).toEqual({});
  });

  it("sends per-recipe interaction counts", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await seedEvent(t, { recipeId: "r1", action: "shown" });
    await seedEvent(t, { recipeId: "r1", action: "shown" });

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    const interactions = calls[0].body.interactions as Record<string, { shown: number }>;
    expect(interactions.r1.shown).toBe(2);
  });

  // Suggesting what is already on the week's plan is noise on either surface.
  it("excludes recipes already on the plan", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await t.withIdentity(identity).mutation(api.basket.add, { recipeId: "r9", title: "Planned" });

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    expect(calls[0].body.excludeRecipeIds).toEqual(["r9"]);
  });

  // The avoid list is a hard pre-filter on BOTH surfaces. A second surface that
  // forgot to forward it would be a safety bug, not a ranking one.
  it("forwards the avoid list", async () => {
    const t = convexTest(schema, modules);
    const calls = stubService();
    await t.withIdentity(identity).mutation(api.preferences.set, { avoidItems: ["peanut"] });

    await t.withIdentity(identity).action(api.recommendations.discover, {});

    const prefs = calls[0].body.preferences as { avoidItems: string[] };
    expect(prefs.avoidItems).toContain("peanut");
  });

  it("returns an empty list rather than throwing when the corpus is empty", async () => {
    const t = convexTest(schema, modules);
    stubService({ results: [] });

    const out = await t.withIdentity(identity).action(api.recommendations.discover, {});

    expect(out).toEqual([]);
  });
});
