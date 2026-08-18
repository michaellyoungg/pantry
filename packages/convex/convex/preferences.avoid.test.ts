import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const USER_ID = "user-a";
const identity = { subject: `${USER_ID}|session` };

/**
 * Canonicalizing avoid entries on entry (BL-0052).
 *
 * The dictionary lives in recipe-service, so these stub it and pin the wiring;
 * the live contract is covered by the Go tests for POST /normalization/avoid.
 * What is asserted here is the part Convex owns: that what gets STORED is the
 * canonical key rather than what the user typed, that the resolution survives
 * beside it so the UI can still explain the entry after a reload, and that a
 * dictionary we cannot reach fails the write instead of storing an entry that
 * would match nothing.
 */
describe("addAvoidItems", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function stubResolver(
    respond: (entries: string[]) => unknown,
    init: { status?: number } = {},
  ): { asked: string[][] } {
    vi.stubEnv("RECIPE_SERVICE_URL", "http://recipe-service");
    vi.stubEnv("RECIPE_SERVICE_SECRET", "s3cret");
    const asked: string[][] = [];
    globalThis.fetch = (async (url: string, req: RequestInit) => {
      expect(String(url)).toBe("http://recipe-service/normalization/avoid");
      const body = JSON.parse(req.body as string) as { entries: string[] };
      asked.push(body.entries);
      return new Response(JSON.stringify(respond(body.entries)), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { asked };
  }

  const scallion = {
    input: "Scallion",
    canonicalItem: "green onion",
    display: "Green onion",
    kind: "item" as const,
  };
  const peanutFamily = {
    input: "peanut",
    canonicalItem: "peanut",
    display: "Peanuts",
    kind: "allergen" as const,
    members: ["Peanut butter", "Peanuts"],
  };
  const nonsense = {
    input: "unobtainium",
    canonicalItem: "unobtainium",
    display: "unobtainium",
    kind: "unknown" as const,
  };

  it("stores the canonical key, not what the user typed", async () => {
    const t = convexTest(schema, modules);
    stubResolver(() => ({ entries: [scallion] }));

    const asUser = t.withIdentity(identity);
    await asUser.action(api.preferences.addAvoidItems, { entries: ["Scallion"] });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["green onion"]);
    expect(prefs.avoidResolutions).toEqual([
      { canonicalItem: "green onion", input: "Scallion", display: "Green onion", kind: "item" },
    ]);
  });

  it("keeps the entry that matched nothing, and says so", async () => {
    const t = convexTest(schema, modules);
    stubResolver(() => ({ entries: [nonsense] }));

    const asUser = t.withIdentity(identity);
    const returned = await asUser.action(api.preferences.addAvoidItems, {
      entries: ["unobtainium"],
    });

    // Returned to the caller so the moment of typing can be answered...
    expect(returned).toEqual([nonsense]);
    // ...and stored, so a reload still shows it as unmatched rather than
    // silently rendering it like every other entry.
    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["unobtainium"]);
    expect(prefs.avoidResolutions[0]).toMatchObject({ kind: "unknown" });
  });

  it("stores an allergen family with the members it excludes", async () => {
    const t = convexTest(schema, modules);
    stubResolver(() => ({ entries: [peanutFamily] }));

    const asUser = t.withIdentity(identity);
    await asUser.action(api.preferences.addAvoidItems, { entries: ["peanut"] });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.avoidResolutions[0]).toMatchObject({
      kind: "allergen",
      members: ["Peanut butter", "Peanuts"],
    });
  });

  it("merges into the existing list instead of replacing it", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    stubResolver(() => ({ entries: [scallion] }));
    await asUser.action(api.preferences.addAvoidItems, { entries: ["Scallion"] });

    stubResolver(() => ({ entries: [peanutFamily] }));
    await asUser.action(api.preferences.addAvoidItems, { entries: ["peanut"] });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["green onion", "peanut"]);
    expect(prefs.avoidResolutions).toHaveLength(2);
  });

  it("re-adding an entry updates its resolution rather than duplicating the key", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    stubResolver(() => ({ entries: [scallion] }));
    await asUser.action(api.preferences.addAvoidItems, { entries: ["Scallion"] });

    stubResolver(() => ({ entries: [{ ...scallion, input: "green onions" }] }));
    await asUser.action(api.preferences.addAvoidItems, { entries: ["green onions"] });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["green onion"]);
    expect(prefs.avoidResolutions).toHaveLength(1);
    expect(prefs.avoidResolutions[0].input).toBe("green onions");
  });

  it("resolves several entries in one call — the diet-seed path", async () => {
    const t = convexTest(schema, modules);
    const { asked } = stubResolver((entries) => ({
      entries: entries.map((input) => ({
        input,
        canonicalItem: input,
        display: input,
        kind: "item" as const,
      })),
    }));

    const asUser = t.withIdentity(identity);
    await asUser.action(api.preferences.addAvoidItems, { entries: ["milk", "butter", "egg"] });

    expect(asked).toEqual([["milk", "butter", "egg"]]);
    expect((await asUser.query(api.preferences.get, {})).avoidItems).toEqual([
      "milk",
      "butter",
      "egg",
    ]);
  });

  it("stores nothing when the dictionary cannot be reached", async () => {
    const t = convexTest(schema, modules);
    stubResolver(() => ({}), { status: 503 });

    const asUser = t.withIdentity(identity);
    await expect(
      asUser.action(api.preferences.addAvoidItems, { entries: ["peanut"] }),
    ).rejects.toThrow(/try again/i);

    // Fail closed: an entry stored raw would sit in the list looking like a
    // filter while matching nothing.
    expect((await asUser.query(api.preferences.get, {})).avoidItems).toEqual([]);
  });

  it("does not call the service for blank input", async () => {
    const t = convexTest(schema, modules);
    const { asked } = stubResolver(() => ({ entries: [] }));

    const returned = await t
      .withIdentity(identity)
      .action(api.preferences.addAvoidItems, { entries: ["   ", ""] });

    expect(returned).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    stubResolver(() => ({ entries: [scallion] }));
    await expect(
      t.action(api.preferences.addAvoidItems, { entries: ["scallion"] }),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("removeAvoidItem", () => {
  it("removes the entry and its resolution together", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("preferences", {
        userId: USER_ID,
        avoidItems: ["green onion", "peanut"],
        avoidResolutions: [
          { canonicalItem: "green onion", input: "scallion", display: "Green onion", kind: "item" },
          { canonicalItem: "peanut", input: "peanut", display: "Peanuts", kind: "allergen" },
        ],
        likedItems: [],
        dislikedItems: [],
        updatedAt: 0,
      });
    });

    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.preferences.removeAvoidItem, { canonicalItem: "green onion" });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.avoidResolutions).toHaveLength(1);
    expect(prefs.avoidResolutions[0].canonicalItem).toBe("peanut");
  });

  it("needs no dictionary — it works when recipe-service is unreachable", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.preferences.set, { avoidItems: ["peanut"] });

    await asUser.mutation(api.preferences.removeAvoidItem, { canonicalItem: "peanut" });

    expect((await asUser.query(api.preferences.get, {})).avoidItems).toEqual([]);
  });
});

// `set` predates resolutions and still writes avoidItems directly. It must not
// destroy them — a Convex patch that omits an optional field DELETES it — and
// must not leave one describing an entry that is gone.
describe("set alongside resolutions", () => {
  async function seeded() {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("preferences", {
        userId: USER_ID,
        avoidItems: ["green onion", "peanut"],
        avoidResolutions: [
          { canonicalItem: "green onion", input: "scallion", display: "Green onion", kind: "item" },
          { canonicalItem: "peanut", input: "peanut", display: "Peanuts", kind: "allergen" },
        ],
        likedItems: [],
        dislikedItems: [],
        updatedAt: 0,
      });
    });
    return t;
  }

  it("keeps resolutions when writing an unrelated preference", async () => {
    const t = await seeded();
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.preferences.set, { cuisines: ["thai"] });

    expect((await asUser.query(api.preferences.get, {})).avoidResolutions).toHaveLength(2);
  });

  it("drops resolutions for entries it removed", async () => {
    const t = await seeded();
    const asUser = t.withIdentity(identity);

    await asUser.mutation(api.preferences.set, { avoidItems: ["peanut"] });

    const prefs = await asUser.query(api.preferences.get, {});
    expect(prefs.avoidItems).toEqual(["peanut"]);
    expect(prefs.avoidResolutions.map((r) => r.canonicalItem)).toEqual(["peanut"]);
  });
});
