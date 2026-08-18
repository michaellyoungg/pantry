import type { EquipmentMatchResult } from "@pantry/types";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// The Convex half of BL-0043. recipe-service is stubbed throughout: what needs
// pinning here is the inventory's own behaviour (idempotent toggling, absence
// meaning "doesn't own it", acquisition dates that survive a re-check) and what
// Convex sends to and projects out of the match endpoint. The matching logic
// itself is tested in Go.
const modules = import.meta.glob("./**/*.*s");

const identity = { subject: "user-a|session" };

interface Recorded {
  path: string;
  body: { owned: string[]; acquired?: string[] };
}

function emptyResult(): EquipmentMatchResult {
  return { recipes: [], counts: { makeable: 0, blocked: 0, unknown: 0 } };
}

/** Stubs recipe-service and records what it was asked. */
function recordRequests(reply: () => EquipmentMatchResult = emptyResult) {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify(reply()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service:8080");
  vi.stubEnv("RECIPE_SERVICE_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("inventory", () => {
  it("records what the user owns and reads it back", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "sous_vide_circulator", owned: true });

    const rows = await t.query(api.equipment.list, {});
    expect(rows.map((r) => r.equipmentId)).toEqual(["sous_vide_circulator"]);
  });

  it("is idempotent — checking twice does not duplicate the row", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: true });
    await t.mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: true });

    expect(await t.query(api.equipment.list, {})).toHaveLength(1);
  });

  it("keeps the original acquisition date when an owned item is re-checked", async () => {
    // "New to your kitchen" means when you got it. A stray toggle must not
    // resurface a two-year-old blender as news.
    const t = convexTest(schema, modules).withIdentity(identity);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await t.mutation(api.equipment.setOwned, { equipmentId: "blender", owned: true });
      vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
      await t.mutation(api.equipment.setOwned, { equipmentId: "blender", owned: true });
    } finally {
      vi.useRealTimers();
    }

    const [row] = await t.query(api.equipment.list, {});
    expect(row.addedAt).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("un-checking removes the row rather than storing a false", async () => {
    // Absence is "doesn't own it"; there is no third state to represent.
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: true });
    await t.mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: false });

    expect(await t.query(api.equipment.list, {})).toEqual([]);
  });

  it("un-checking something never owned is a no-op, not an error", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: false });
    expect(await t.query(api.equipment.list, {})).toEqual([]);
  });

  it("lists most recently acquired first", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await t.mutation(api.equipment.setOwned, { equipmentId: "oven", owned: true });
      vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
      await t.mutation(api.equipment.setOwned, { equipmentId: "panini_press", owned: true });
    } finally {
      vi.useRealTimers();
    }

    const rows = await t.query(api.equipment.list, {});
    expect(rows.map((r) => r.equipmentId)).toEqual(["panini_press", "oven"]);
  });

  it("keeps one user's kitchen out of another's", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "user-a|session" })
      .mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: true });

    const other = await t.withIdentity({ subject: "user-b|session" }).query(api.equipment.list, {});
    expect(other).toEqual([]);
  });

  it("refuses to read an inventory without an identity", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.equipment.list, {})).rejects.toThrow(/Not authenticated/);
  });
});

describe("makeability", () => {
  it("sends the owned slugs and returns a fit keyed by recipe id", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "oven", owned: true });
    const calls = recordRequests(() => ({
      recipes: [
        {
          id: "r1",
          userId: "user-a",
          title: "Roast",
          ingredients: [],
          steps: [],
          equipment: [{ id: "oven", required: true }],
          methods: [],
          createdAt: "2026-08-03T00:00:00Z",
          status: "makeable",
          missing: [],
          unlockedBy: [],
        },
      ],
      counts: { makeable: 1, blocked: 0, unknown: 2 },
    }));

    const result = await t.action(api.equipment.makeability, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/equipment/match");
    expect(calls[0].body.owned).toEqual(["oven"]);
    expect(calls[0].body.acquired).toBeUndefined();
    expect(result.fits.r1).toEqual({ status: "makeable", missing: [], unlockedBy: [] });
    // Recipe bodies are dropped: the catalog already has them on screen.
    expect(result.fits.r1).not.toHaveProperty("title");
  });

  it("carries the unknown count through rather than folding it away", async () => {
    // The whole point of the three-valued status: the UI has to be able to say
    // how many recipes it genuinely cannot assess.
    const t = convexTest(schema, modules).withIdentity(identity);
    recordRequests(() => ({ recipes: [], counts: { makeable: 1, blocked: 2, unknown: 7 } }));

    const result = await t.action(api.equipment.makeability, {});
    expect(result.counts).toEqual({ makeable: 1, blocked: 2, unknown: 7 });
  });

  it("still asks when the inventory is empty", async () => {
    // An empty kitchen is a real answer — everything tagged is blocked — and
    // the counts are what tells the user the filter has nothing to work with.
    const t = convexTest(schema, modules).withIdentity(identity);
    const calls = recordRequests();

    await t.action(api.equipment.makeability, {});
    expect(calls[0].body.owned).toEqual([]);
  });
});

describe("unlockedBy", () => {
  it("asks the match endpoint to single out the new device", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "oven", owned: true });
    await t.mutation(api.equipment.setOwned, { equipmentId: "panini_press", owned: true });
    const calls = recordRequests();

    await t.action(api.equipment.unlockedBy, { equipmentId: "panini_press" });

    expect(calls[0].body.owned.sort()).toEqual(["oven", "panini_press"]);
    expect(calls[0].body.acquired).toEqual(["panini_press"]);
  });

  it("returns the whole recipes, since there is nothing on screen to join onto", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.equipment.setOwned, { equipmentId: "panini_press", owned: true });
    recordRequests(() => ({
      recipes: [
        {
          id: "r1",
          userId: "user-a",
          title: "Cubano",
          ingredients: [],
          steps: [],
          equipment: [{ id: "panini_press", required: true }],
          methods: [],
          createdAt: "2026-08-03T00:00:00Z",
          status: "makeable",
          missing: [],
          unlockedBy: ["panini_press"],
        },
      ],
      counts: { makeable: 1, blocked: 0, unknown: 0 },
    }));

    const unlocked = await t.action(api.equipment.unlockedBy, { equipmentId: "panini_press" });
    expect(unlocked.map((r) => r.title)).toEqual(["Cubano"]);
    expect(unlocked[0].unlockedBy).toEqual(["panini_press"]);
  });

  it("returns nothing for a device the user does not own, without calling out", async () => {
    // The inventory is reactive: an un-check racing this call is normal, not an
    // error worth showing anyone.
    const t = convexTest(schema, modules).withIdentity(identity);
    const calls = recordRequests();

    const unlocked = await t.action(api.equipment.unlockedBy, { equipmentId: "smoker" });
    expect(unlocked).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("ownedSlugs", () => {
  it("is scoped to the user it is asked about", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "user-a|session" })
      .mutation(api.equipment.setOwned, { equipmentId: "smoker", owned: true });

    expect(await t.query(internal.equipment.ownedSlugs, { userId: "user-b" })).toEqual([]);
  });
});
